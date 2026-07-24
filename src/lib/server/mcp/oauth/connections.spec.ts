import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { collections, ready } from "$lib/server/database";
import {
	cleanupTestData,
	createTestLocals,
	createTestUser,
} from "$lib/server/api/__tests__/testHelpers";
import {
	consumeAuthorizationFlow,
	createOAuthConnection,
	getOAuthConnection,
	migrateOAuthConnectionsToUser,
	publicOAuthState,
	saveAuthorizationFlow,
	storeAuthorizationTokens,
} from "./connections";

const asMetadata = {
	issuer: "https://auth.example.com",
	authorization_endpoint: "https://auth.example.com/authorize",
	token_endpoint: "https://auth.example.com/token",
	response_types_supported: ["code"],
};

const clientInfo = {
	client_id: "client-id",
	client_secret: "client-secret",
	redirect_uris: ["https://chat.example.com/api/mcp/oauth/callback"],
};

async function createConnection(locals: App.Locals) {
	return createOAuthConnection(locals, {
		serverUrl: "https://mcp.example.com/mcp",
		resource: "https://mcp.example.com/mcp",
		resourceMetadataUrl: "https://mcp.example.com/.well-known/oauth-protected-resource/mcp",
		asMetadata,
		clientInfo,
	});
}

beforeAll(async () => {
	await ready;
}, 30_000);

describe.sequential("server-side MCP OAuth connections", () => {
	afterEach(async () => {
		await cleanupTestData();
	});

	it("returns only a non-secret browser projection", async () => {
		const locals = createTestLocals();
		const connection = await createConnection(locals);
		await collections.mcpOAuthConnections.updateOne(
			{ _id: connection._id },
			{
				$set: {
					tokens: {
						access_token: "access-secret",
						refresh_token: "refresh-secret",
						token_type: "Bearer",
						scope: "tools.read",
						expires_at: Date.now() + 60_000,
					},
					status: "authorized",
				},
			}
		);

		const stored = await collections.mcpOAuthConnections.findOne({ _id: connection._id });
		if (!stored) throw new Error("expected OAuth connection");
		const state = publicOAuthState(stored);
		expect(state).toEqual(
			expect.objectContaining({
				connectionId: connection._id.toString(),
				issuer: asMetadata.issuer,
				status: "authorized",
				scope: "tools.read",
			})
		);
		const serialized = JSON.stringify(state);
		expect(serialized).not.toContain("access-secret");
		expect(serialized).not.toContain("refresh-secret");
		expect(serialized).not.toContain("client-secret");
		expect(serialized).not.toContain("token_endpoint");
	});

	it("does not allow a different user or anonymous session to resolve a connection", async () => {
		const { locals: owner } = await createTestUser();
		const { locals: otherUser } = await createTestUser();
		const userConnection = await createConnection(owner);

		await expect(getOAuthConnection(otherUser, userConnection._id.toString())).rejects.toThrow(
			/not found/
		);

		const anonymousOwner = createTestLocals({ sessionId: "anonymous-owner" });
		const anonymousOther = createTestLocals({ sessionId: "anonymous-other" });
		const anonymousConnection = await createConnection(anonymousOwner);
		await expect(
			getOAuthConnection(anonymousOther, anonymousConnection._id.toString())
		).rejects.toThrow(/not found/);
	});

	it("keeps anonymous credentials on a renewable TTL", async () => {
		const anonymousOwner = createTestLocals({ sessionId: "anonymous-owner" });
		const connection = await createConnection(anonymousOwner);
		const authorized = await storeAuthorizationTokens(anonymousOwner, connection, {
			access_token: "anonymous-access",
			refresh_token: "anonymous-refresh",
			token_type: "Bearer",
		});

		expect(authorized.deleteAt?.getTime()).toBeGreaterThan(Date.now() + 13 * 24 * 60 * 60 * 1000);

		const previousExpiry = new Date(Date.now() + 60_000);
		await collections.mcpOAuthConnections.updateOne(
			{ _id: connection._id },
			{ $set: { deleteAt: previousExpiry } }
		);
		const renewed = await getOAuthConnection(anonymousOwner, connection._id.toString());
		expect(renewed.deleteAt?.getTime()).toBeGreaterThan(previousExpiry.getTime());

		const { locals: userOwner } = await createTestUser();
		const userConnection = await createConnection(userOwner);
		const userAuthorized = await storeAuthorizationTokens(userOwner, userConnection, {
			access_token: "user-access",
			token_type: "Bearer",
		});
		expect(userAuthorized.deleteAt).toBeUndefined();
	});

	it("migrates anonymous OAuth connections to a user on login", async () => {
		const anonymousOwner = createTestLocals({ sessionId: "anonymous-owner" });
		const authorizedConnection = await createConnection(anonymousOwner);
		await storeAuthorizationTokens(anonymousOwner, authorizedConnection, {
			access_token: "anonymous-access",
			token_type: "Bearer",
		});
		const pendingConnection = await createConnection(anonymousOwner);
		const pendingExpiry = pendingConnection.deleteAt;
		const { user, locals: userOwner } = await createTestUser();

		await expect(migrateOAuthConnectionsToUser("anonymous-owner", user._id)).resolves.toBe(2);

		const migratedAuthorized = await getOAuthConnection(
			userOwner,
			authorizedConnection._id.toString()
		);
		const migratedPending = await getOAuthConnection(userOwner, pendingConnection._id.toString());
		expect(migratedAuthorized.sessionId).toBeUndefined();
		expect(migratedAuthorized.userId).toEqual(user._id);
		expect(migratedAuthorized.deleteAt).toBeUndefined();
		expect(migratedPending.sessionId).toBeUndefined();
		expect(migratedPending.userId).toEqual(user._id);
		expect(migratedPending.deleteAt).toEqual(pendingExpiry);
		await expect(
			getOAuthConnection(anonymousOwner, authorizedConnection._id.toString())
		).rejects.toThrow(/not found/);
	});

	it("consumes callback state exactly once", async () => {
		const locals = createTestLocals();
		const connection = await createConnection(locals);
		const redirectUri = "https://chat.example.com/api/mcp/oauth/callback";
		const state = crypto.randomUUID();
		await saveAuthorizationFlow(locals, connection, {
			clientInfo,
			clientWasManuallyEntered: false,
			flow: {
				id: crypto.randomUUID(),
				expectedState: state,
				verifier: "abcdefghijklmnopqrstuvwxyz-abcdefghijklmnopqrstuvwxyz",
				redirectUri,
				popupMode: true,
				expiresAt: new Date(Date.now() + 60_000),
			},
		});

		const first = await consumeAuthorizationFlow(locals, state, redirectUri);
		const replay = await consumeAuthorizationFlow(locals, state, redirectUri);
		expect(first?.flow?.expectedState).toBe(state);
		expect(replay).toBeNull();
	});

	it("does not let a stale token result overwrite a newer rotated credential", async () => {
		const locals = createTestLocals();
		const stale = await createConnection(locals);
		await collections.mcpOAuthConnections.updateOne(
			{ _id: stale._id, version: stale.version },
			{
				$set: {
					tokens: {
						access_token: "winner-access",
						refresh_token: "winner-refresh",
						token_type: "Bearer",
					},
					status: "authorized",
				},
				$inc: { version: 1 },
			}
		);

		await expect(
			storeAuthorizationTokens(locals, stale, {
				access_token: "stale-access",
				refresh_token: "stale-refresh",
				token_type: "Bearer",
			})
		).rejects.toThrow(/superseded/);

		const persisted = await collections.mcpOAuthConnections.findOne({ _id: stale._id });
		expect(persisted?.tokens?.access_token).toBe("winner-access");
		expect(persisted?.tokens?.refresh_token).toBe("winner-refresh");
	});
});
