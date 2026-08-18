import {
	discoverAuthorizationServerMetadata,
	discoverOAuthProtectedResourceMetadata,
	extractWWWAuthenticateParams,
	registerClient,
} from "@modelcontextprotocol/sdk/client/auth.js";
import type {
	AuthorizationServerMetadata,
	OAuthClientInformationFull,
	OAuthProtectedResourceMetadata,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { isValidUrl, ssrfSafeFetch } from "$lib/server/urlSafety";
import { logger } from "$lib/server/logger";
import { canonicalizeMcpUri } from "./canonical";
import {
	assertIssuerMatches,
	assertPkceS256Supported,
	assertProtectedResourceMatches,
	assertSafeOAuthUrl,
	parseAuthorizationServerMetadata,
	parseClientInformation,
} from "./validation";
import { LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/sdk/types.js";
import { selectInitialOAuthScope } from "./scope";

export interface DiscoveryResult {
	requiresAuth: boolean;
	resource?: string;
	resourceMetadataUrl?: string;
	resourceMetadata?: OAuthProtectedResourceMetadata;
	asMetadata?: AuthorizationServerMetadata;
	clientInfo?: OAuthClientInformationFull;
	registrationMethod?: "client_metadata_document" | "dynamic";
	requestedScope?: string;
	probeStatus?: number;
}

const PROBE_TIMEOUT_MS = 15_000;
export const MCP_OAUTH_PROTOCOL_VERSION = LATEST_PROTOCOL_VERSION;

export function buildClientMetadataDocumentClient(
	metadata: { client_id_metadata_document_supported?: boolean },
	options: { clientMetadataUri: string; redirectUri: string; appName: string }
): OAuthClientInformationFull | undefined {
	const clientMetadataUri = new URL(options.clientMetadataUri);
	if (
		metadata.client_id_metadata_document_supported !== true ||
		clientMetadataUri.protocol !== "https:" ||
		clientMetadataUri.pathname === "/"
	) {
		return undefined;
	}
	return parseClientInformation({
		client_id: clientMetadataUri.href,
		redirect_uris: [options.redirectUri],
		token_endpoint_auth_method: "none",
		grant_types: ["authorization_code", "refresh_token"],
		response_types: ["code"],
		client_name: options.appName,
	});
}

const probeBody = JSON.stringify({
	jsonrpc: "2.0",
	id: "chat-ui-mcp-probe",
	method: "initialize",
	params: {
		protocolVersion: MCP_OAUTH_PROTOCOL_VERSION,
		capabilities: {},
		clientInfo: { name: "chat-ui-mcp-probe", version: "0.1.0" },
	},
});

async function probeMcpServer(url: string, signal: AbortSignal): Promise<Response> {
	return ssrfSafeFetch(url, {
		method: "POST",
		signal,
		headers: {
			"Content-Type": "application/json",
			Accept: "application/json, text/event-stream",
			"MCP-Protocol-Version": MCP_OAUTH_PROTOCOL_VERSION,
		},
		body: probeBody,
	});
}

/** Walk MCP OAuth discovery: probe → RFC 9728 resource metadata → RFC 8414 AS metadata → client (CIMD, DCR, or manual). Returns requiresAuth:false when the probe already succeeds. */
export async function discoverServerOAuth(
	serverUrl: string,
	options: { redirectUri: string; clientMetadataUri: string; appName: string }
): Promise<DiscoveryResult> {
	if (!isValidUrl(serverUrl)) {
		throw new Error("Server URL is not a public HTTPS URL");
	}

	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);

	let probe: Response;
	try {
		probe = await probeMcpServer(serverUrl, controller.signal);
	} finally {
		clearTimeout(timeout);
	}

	if (probe.status !== 401 && probe.status !== 403) {
		// Drain body to free socket
		try {
			await probe.body?.cancel();
		} catch {}
		return { requiresAuth: false, probeStatus: probe.status };
	}

	const { resourceMetadataUrl, scope: challengeScope } = extractWWWAuthenticateParams(probe);
	try {
		await probe.body?.cancel();
	} catch {}

	const resource = canonicalizeMcpUri(serverUrl);
	if (resourceMetadataUrl) {
		assertSafeOAuthUrl(resourceMetadataUrl, "Protected resource metadata URL");
	}

	const resourceMetadata = await discoverOAuthProtectedResourceMetadata(
		serverUrl,
		resourceMetadataUrl ? { resourceMetadataUrl } : undefined,
		ssrfSafeFetch as unknown as typeof fetch
	);
	assertProtectedResourceMatches(resource, resourceMetadata);

	const asUrl = resourceMetadata.authorization_servers?.[0];
	if (!asUrl) {
		throw new Error(
			"MCP server's protected-resource metadata does not list any authorization_servers"
		);
	}
	assertSafeOAuthUrl(asUrl, "Advertised authorization server");

	const discoveredMetadata = await discoverAuthorizationServerMetadata(asUrl, {
		fetchFn: ssrfSafeFetch as unknown as typeof fetch,
		protocolVersion: MCP_OAUTH_PROTOCOL_VERSION,
	});
	if (!discoveredMetadata) {
		throw new Error(`Could not load authorization server metadata for ${asUrl}`);
	}
	const asMetadata = parseAuthorizationServerMetadata(discoveredMetadata);
	assertIssuerMatches(asUrl, asMetadata);
	assertPkceS256Supported(asMetadata);

	let clientInfo: OAuthClientInformationFull | undefined;
	let registrationMethod: DiscoveryResult["registrationMethod"];
	const requestedScope = selectInitialOAuthScope(challengeScope, resourceMetadata.scopes_supported);
	clientInfo = buildClientMetadataDocumentClient(asMetadata, options);
	if (clientInfo) {
		registrationMethod = "client_metadata_document";
	}
	const supportsDcr = Boolean(asMetadata.registration_endpoint);
	if (!clientInfo && supportsDcr) {
		try {
			const hostname = (() => {
				try {
					return new URL(serverUrl).hostname;
				} catch {
					return serverUrl;
				}
			})();
			clientInfo = parseClientInformation(
				await registerClient(asUrl, {
					metadata: asMetadata,
					clientMetadata: {
						redirect_uris: [options.redirectUri],
						token_endpoint_auth_method: "none",
						grant_types: ["authorization_code", "refresh_token"],
						response_types: ["code"],
						client_name: `${options.appName} – ${hostname}`,
						scope: requestedScope,
						logo_uri: undefined,
						tos_uri: undefined,
					},
					scope: requestedScope,
					fetchFn: ssrfSafeFetch as unknown as typeof fetch,
				})
			);
			if (!clientInfo.redirect_uris.includes(options.redirectUri)) {
				throw new Error("Dynamic client registration returned an unexpected redirect URI");
			}
			registrationMethod = "dynamic";
		} catch (err) {
			logger.warn(
				{ err: String(err), asUrl: asUrl.toString() },
				"[mcp-oauth] dynamic client registration failed; falling back to manual entry"
			);
		}
	}

	return {
		requiresAuth: true,
		resource,
		resourceMetadataUrl: resourceMetadataUrl?.toString(),
		resourceMetadata,
		asMetadata,
		clientInfo,
		registrationMethod,
		requestedScope,
	};
}
