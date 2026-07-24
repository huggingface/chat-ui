import { ObjectId, type Filter } from "mongodb";
import type {
	MCPAuthorizationServerMetadata,
	MCPClientInformation,
	MCPOAuthState,
	MCPOAuthTokens,
} from "$lib/types/Tool";
import type { MCPOAuthAuthorizationFlow, MCPOAuthConnection } from "$lib/types/MCPOAuthConnection";
import { collections } from "$lib/server/database";
import { acquireLock, releaseLock } from "$lib/migrations/lock";
import { canonicalizeMcpUri } from "./canonical";
import type {
	AuthorizationServerMetadata,
	OAuthClientInformationFull,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { extractWWWAuthenticateParams } from "@modelcontextprotocol/sdk/client/auth.js";
import { mergeOAuthScopes, normalizeOAuthScope } from "./scope";
import {
	isRefreshGrantRejected,
	refreshTokens,
	tokensWithExpiresAt,
	tryRevokeToken,
} from "./exchange";

const ABANDONED_CONNECTION_TTL_MS = 15 * 60 * 1000;
const ANONYMOUS_CONNECTION_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const REFRESH_MARGIN_MS = 5 * 60 * 1000;
const REFRESH_WAIT_ATTEMPTS = 25;
const REFRESH_WAIT_MS = 100;

export type OAuthConnectionOwner = Pick<MCPOAuthConnection, "userId" | "sessionId">;

export function oauthConnectionOwner(locals: App.Locals): OAuthConnectionOwner {
	if (locals.user) return { userId: locals.user._id };
	if (locals.sessionId) return { sessionId: locals.sessionId };
	throw new Error("An authenticated user or anonymous session is required");
}

function ownerFilter(locals: App.Locals): Filter<MCPOAuthConnection> {
	const owner = oauthConnectionOwner(locals);
	return owner.userId
		? { userId: owner.userId }
		: { sessionId: owner.sessionId, userId: { $exists: false } };
}

function connectionFilter(locals: App.Locals, connectionId: string): Filter<MCPOAuthConnection> {
	if (!ObjectId.isValid(connectionId)) {
		throw new OAuthConnectionAccessError("OAuth connection was not found");
	}
	return { _id: new ObjectId(connectionId), ...ownerFilter(locals) };
}

export class OAuthConnectionAccessError extends Error {
	constructor(message = "OAuth connection was not found") {
		super(message);
		this.name = "OAuthConnectionAccessError";
	}
}

export class OAuthAuthorizationRequiredError extends Error {
	constructor(message = "MCP authorization is required") {
		super(message);
		this.name = "OAuthAuthorizationRequiredError";
	}
}

export function publicOAuthState(connection: MCPOAuthConnection): MCPOAuthState {
	return {
		connectionId: connection._id.toString(),
		issuer: connection.asMetadata.issuer,
		status:
			connection.tokens && !connection.scopeChallenge ? "authorized" : "authorization_required",
		scope:
			connection.scopeChallenge?.scope ?? connection.tokens?.scope ?? connection.requestedScope,
		expiresAt: connection.tokens?.expires_at,
		manualClientRequired: !connection.clientInfo,
		clientWasManuallyEntered: connection.clientWasManuallyEntered,
	};
}

export async function createOAuthConnection(
	locals: App.Locals,
	input: {
		serverUrl: string;
		resource: string;
		resourceMetadataUrl?: string;
		asMetadata: MCPAuthorizationServerMetadata;
		clientInfo?: MCPClientInformation;
		registrationMethod?: MCPOAuthConnection["registrationMethod"];
		requestedScope?: string;
	}
): Promise<MCPOAuthConnection> {
	const now = new Date();
	const connection: MCPOAuthConnection = {
		_id: new ObjectId(),
		...oauthConnectionOwner(locals),
		serverUrl: canonicalizeMcpUri(input.serverUrl),
		resource: canonicalizeMcpUri(input.resource),
		resourceMetadataUrl: input.resourceMetadataUrl,
		asMetadata: input.asMetadata,
		clientInfo: input.clientInfo,
		registrationMethod: input.registrationMethod,
		requestedScope: input.requestedScope,
		status: "authorization_required",
		version: 0,
		createdAt: now,
		updatedAt: now,
		deleteAt: new Date(now.getTime() + ABANDONED_CONNECTION_TTL_MS),
	};
	await collections.mcpOAuthConnections.insertOne(connection);
	return connection;
}

export async function getOAuthConnection(
	locals: App.Locals,
	connectionId: string
): Promise<MCPOAuthConnection> {
	const filter = connectionFilter(locals, connectionId);
	const owner = oauthConnectionOwner(locals);
	const connection = owner.sessionId
		? ((await collections.mcpOAuthConnections.findOneAndUpdate(
				{ ...filter, tokens: { $exists: true } },
				{
					$set: {
						deleteAt: new Date(Date.now() + ANONYMOUS_CONNECTION_TTL_MS),
						updatedAt: new Date(),
					},
				},
				{ returnDocument: "after", includeResultMetadata: false }
			)) ?? (await collections.mcpOAuthConnections.findOne(filter)))
		: await collections.mcpOAuthConnections.findOne(filter);
	if (!connection) throw new OAuthConnectionAccessError();
	return connection;
}

export async function migrateOAuthConnectionsToUser(
	sessionId: string,
	userId: ObjectId
): Promise<number> {
	const result = await collections.mcpOAuthConnections.updateMany(
		{ sessionId, userId: { $exists: false } },
		[
			{
				$set: {
					userId,
					sessionId: "$$REMOVE",
					updatedAt: new Date(),
					deleteAt: {
						$cond: [{ $eq: [{ $type: "$tokens" }, "missing"] }, "$deleteAt", "$$REMOVE"],
					},
				},
			},
		]
	);
	return result.modifiedCount;
}

export async function saveAuthorizationFlow(
	locals: App.Locals,
	connection: MCPOAuthConnection,
	input: {
		flow: MCPOAuthAuthorizationFlow;
		clientInfo: MCPClientInformation;
		clientWasManuallyEntered: boolean;
	}
): Promise<MCPOAuthConnection> {
	if (connection.scopeChallenge && connection.scopeChallenge.attempts > 2) {
		throw new OAuthAuthorizationRequiredError(
			"MCP scope upgrade failed after the maximum number of attempts"
		);
	}
	const updated = await collections.mcpOAuthConnections.findOneAndUpdate(
		{
			...connectionFilter(locals, connection._id.toString()),
			version: connection.version,
		},
		{
			$set: {
				clientInfo: input.clientInfo,
				clientWasManuallyEntered: input.clientWasManuallyEntered,
				registrationMethod: input.clientWasManuallyEntered
					? "manual"
					: connection.registrationMethod,
				flow: input.flow,
				status: "authorization_required",
				updatedAt: new Date(),
			},
			$inc: { version: 1 },
		},
		{ returnDocument: "after", includeResultMetadata: false }
	);
	if (!updated) throw new Error("OAuth connection changed while authorization was starting");
	return updated;
}

/**
 * Atomically removes an in-flight flow before the authorization code is
 * exchanged. A callback can therefore be consumed only once, including error
 * callbacks.
 */
export async function consumeAuthorizationFlow(
	locals: App.Locals,
	state: string,
	redirectUri: string
): Promise<MCPOAuthConnection | null> {
	if (!state) return null;
	return collections.mcpOAuthConnections.findOneAndUpdate(
		{
			...ownerFilter(locals),
			"flow.expectedState": state,
			"flow.redirectUri": redirectUri,
			"flow.expiresAt": { $gt: new Date() },
		},
		{
			$unset: { flow: "" },
			$set: { updatedAt: new Date() },
		},
		{ returnDocument: "before", includeResultMetadata: false }
	);
}

export async function storeAuthorizationTokens(
	locals: App.Locals,
	connection: MCPOAuthConnection,
	tokens: MCPOAuthTokens
): Promise<MCPOAuthConnection> {
	const sessionOwned = Boolean(oauthConnectionOwner(locals).sessionId);
	const updated = await collections.mcpOAuthConnections.findOneAndUpdate(
		{
			...connectionFilter(locals, connection._id.toString()),
			version: connection.version,
		},
		{
			$set: {
				tokens,
				status: "authorized",
				requestedScope: tokens.scope ?? connection.requestedScope,
				...(connection.scopeChallenge ? { lastScopeChallenge: connection.scopeChallenge } : {}),
				...(sessionOwned ? { deleteAt: new Date(Date.now() + ANONYMOUS_CONNECTION_TTL_MS) } : {}),
				updatedAt: new Date(),
			},
			$unset: {
				scopeChallenge: "",
				...(sessionOwned ? {} : { deleteAt: "" }),
			},
			$inc: { version: 1 },
		},
		{ returnDocument: "after", includeResultMetadata: false }
	);
	if (!updated) throw new Error("OAuth authorization flow was superseded");
	return updated;
}

function tokenNeedsRefresh(tokens: MCPOAuthTokens): boolean {
	return Boolean(tokens.expires_at && Date.now() + REFRESH_MARGIN_MS >= tokens.expires_at);
}

function accessTokenHasExpired(tokens: MCPOAuthTokens): boolean {
	return Boolean(tokens.expires_at && Date.now() >= tokens.expires_at);
}

async function waitForConcurrentRefresh(
	locals: App.Locals,
	connectionId: string,
	previousVersion: number
): Promise<MCPOAuthConnection> {
	for (let attempt = 0; attempt < REFRESH_WAIT_ATTEMPTS; attempt++) {
		await new Promise((resolve) => setTimeout(resolve, REFRESH_WAIT_MS));
		const current = await getOAuthConnection(locals, connectionId);
		if (current.version > previousVersion) return current;
	}
	throw new Error("MCP OAuth token refresh is still in progress");
}

async function refreshConnection(
	locals: App.Locals,
	connection: MCPOAuthConnection
): Promise<MCPOAuthConnection> {
	const connectionId = connection._id.toString();
	const lockKey = `mcp.oauth.refresh:${connectionId}`;
	const lockId = await acquireLock(lockKey);
	if (!lockId) {
		return waitForConcurrentRefresh(locals, connectionId, connection.version);
	}

	try {
		const current = await getOAuthConnection(locals, connectionId);
		if (!current.tokens) throw new OAuthAuthorizationRequiredError();
		if (!tokenNeedsRefresh(current.tokens)) return current;
		if (!current.tokens.refresh_token) {
			if (!accessTokenHasExpired(current.tokens)) return current;
			throw new OAuthAuthorizationRequiredError("MCP authorization has expired");
		}
		if (!current.clientInfo) {
			throw new OAuthAuthorizationRequiredError("OAuth client registration is missing");
		}

		let fresh: MCPOAuthTokens;
		try {
			const response = await refreshTokens({
				asMetadata: current.asMetadata as AuthorizationServerMetadata,
				clientInfo: current.clientInfo as OAuthClientInformationFull,
				resource: current.resource,
				refreshToken: current.tokens.refresh_token,
			});
			fresh = tokensWithExpiresAt(response);
		} catch (error) {
			if (isRefreshGrantRejected(error)) {
				await collections.mcpOAuthConnections.updateOne(
					{
						...connectionFilter(locals, connectionId),
						version: current.version,
						"tokens.refresh_token": current.tokens.refresh_token,
					},
					{
						$unset: { tokens: "" },
						$set: { status: "authorization_required", updatedAt: new Date() },
						$inc: { version: 1 },
					}
				);
				throw new OAuthAuthorizationRequiredError("MCP authorization must be renewed");
			}
			throw error;
		}

		const nextTokens: MCPOAuthTokens = {
			...fresh,
			refresh_token: fresh.refresh_token ?? current.tokens.refresh_token,
		};
		const updated = await collections.mcpOAuthConnections.findOneAndUpdate(
			{
				...connectionFilter(locals, connectionId),
				version: current.version,
				"tokens.refresh_token": current.tokens.refresh_token,
			},
			{
				$set: { tokens: nextTokens, status: "authorized", updatedAt: new Date() },
				$inc: { version: 1 },
			},
			{ returnDocument: "after", includeResultMetadata: false }
		);
		if (updated) return updated;
		return getOAuthConnection(locals, connectionId);
	} finally {
		await releaseLock(lockKey, lockId);
	}
}

export async function resolveOAuthAccessToken(
	locals: App.Locals,
	connectionId: string,
	expectedServerUrl: string
): Promise<{ accessToken: string; state: MCPOAuthState }> {
	let connection = await getOAuthConnection(locals, connectionId);
	if (connection.serverUrl !== canonicalizeMcpUri(expectedServerUrl)) {
		throw new OAuthConnectionAccessError("OAuth connection is bound to a different MCP resource");
	}
	if (connection.scopeChallenge) {
		throw new OAuthAuthorizationRequiredError(
			`Additional MCP authorization is required for scope: ${connection.scopeChallenge.scope}`
		);
	}
	if (!connection.tokens) throw new OAuthAuthorizationRequiredError();
	if (tokenNeedsRefresh(connection.tokens)) {
		connection = await refreshConnection(locals, connection);
	}
	if (!connection.tokens || accessTokenHasExpired(connection.tokens)) {
		throw new OAuthAuthorizationRequiredError("MCP authorization has expired");
	}
	return {
		accessToken: connection.tokens.access_token,
		state: publicOAuthState(connection),
	};
}

export async function recordInsufficientScope(
	locals: App.Locals,
	connectionId: string,
	expectedServerUrl: string,
	scope: string
): Promise<MCPOAuthState> {
	const connection = await getOAuthConnection(locals, connectionId);
	if (connection.serverUrl !== canonicalizeMcpUri(expectedServerUrl)) {
		throw new OAuthConnectionAccessError("OAuth connection is bound to a different MCP resource");
	}
	const requiredScope = mergeOAuthScopes(
		connection.tokens?.scope,
		connection.requestedScope,
		normalizeOAuthScope(scope)
	);
	if (!requiredScope) throw new Error("Insufficient-scope response did not include a valid scope");
	const previous =
		connection.scopeChallenge?.scope === requiredScope
			? connection.scopeChallenge
			: connection.lastScopeChallenge?.scope === requiredScope
				? connection.lastScopeChallenge
				: undefined;
	const attempts = connection.scopeChallenge
		? connection.scopeChallenge.attempts
		: (previous?.attempts ?? 0) + 1;
	const updated = await collections.mcpOAuthConnections.findOneAndUpdate(
		{
			...connectionFilter(locals, connectionId),
			version: connection.version,
		},
		{
			$set: {
				scopeChallenge: { scope: requiredScope, attempts, updatedAt: new Date() },
				requestedScope: requiredScope,
				status: "authorization_required",
				updatedAt: new Date(),
			},
			$inc: { version: 1 },
		},
		{ returnDocument: "after", includeResultMetadata: false }
	);
	if (!updated) throw new Error("OAuth connection changed while recording a scope challenge");
	return publicOAuthState(updated);
}

export async function captureInsufficientScopeResponse(
	locals: App.Locals,
	connectionId: string,
	expectedServerUrl: string,
	response: Response
): Promise<MCPOAuthState | undefined> {
	if (response.status !== 403) return undefined;
	const challenge = extractWWWAuthenticateParams(response);
	if (challenge.error !== "insufficient_scope" || !challenge.scope) return undefined;
	return recordInsufficientScope(locals, connectionId, expectedServerUrl, challenge.scope);
}

export async function deleteOAuthConnection(
	locals: App.Locals,
	connectionId: string
): Promise<{ revoked: boolean }> {
	const connection = await collections.mcpOAuthConnections.findOneAndDelete(
		connectionFilter(locals, connectionId),
		{ includeResultMetadata: false }
	);
	if (!connection) throw new OAuthConnectionAccessError();

	const token = connection.tokens?.refresh_token ?? connection.tokens?.access_token;
	if (!token || !connection.clientInfo) return { revoked: false };
	return {
		revoked: await tryRevokeToken({
			asMetadata: connection.asMetadata as AuthorizationServerMetadata,
			clientInfo: connection.clientInfo as OAuthClientInformationFull,
			token,
			tokenTypeHint: connection.tokens?.refresh_token ? "refresh_token" : "access_token",
		}),
	};
}
