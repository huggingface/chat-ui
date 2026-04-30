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

export interface DiscoveryResult {
	requiresAuth: boolean;
	// Set when requiresAuth=true
	resource?: string;
	resourceMetadataUrl?: string;
	resourceMetadata?: OAuthProtectedResourceMetadata;
	asMetadata?: AuthorizationServerMetadata;
	clientInfo?: OAuthClientInformationFull;
	supportsDcr?: boolean;
	// Set when requiresAuth=false but the probe succeeded; informational.
	probeStatus?: number;
}

const PROBE_TIMEOUT_MS = 15_000;
const PROTOCOL_VERSION = "2025-06-18";

const probeBody = JSON.stringify({
	jsonrpc: "2.0",
	id: "chat-ui-mcp-probe",
	method: "initialize",
	params: {
		protocolVersion: PROTOCOL_VERSION,
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
			"MCP-Protocol-Version": PROTOCOL_VERSION,
		},
		body: probeBody,
	});
}

/**
 * Walk the MCP authorization discovery dance from a server URL:
 *
 *   1. Probe the MCP server with an `initialize` request (no auth).
 *   2. If we get a 401, parse the `WWW-Authenticate` header for the RFC 9728
 *      `resource_metadata` URL.
 *   3. Fetch the Protected Resource Metadata (RFC 9728) and pick the first
 *      `authorization_servers[]` entry.
 *   4. Fetch the Authorization Server Metadata (RFC 8414, with OIDC fallback).
 *   5. If the AS exposes `registration_endpoint`, do RFC 7591 Dynamic Client
 *      Registration so the user doesn't have to paste a client ID.
 *
 * Throws on hard failures (network errors, unparseable metadata). Returns
 * `requiresAuth: false` if the probe succeeded with 2xx — meaning the server
 * does not need auth.
 */
export async function discoverServerOAuth(
	serverUrl: string,
	options: { redirectUri: string; appName: string }
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

	const { resourceMetadataUrl } = extractWWWAuthenticateParams(probe);
	try {
		await probe.body?.cancel();
	} catch {}

	const resource = canonicalizeMcpUri(serverUrl);

	const resourceMetadata = await discoverOAuthProtectedResourceMetadata(
		serverUrl,
		resourceMetadataUrl ? { resourceMetadataUrl } : undefined,
		ssrfSafeFetch as unknown as typeof fetch
	);

	const asUrl = resourceMetadata.authorization_servers?.[0];
	if (!asUrl) {
		throw new Error(
			"MCP server's protected-resource metadata does not list any authorization_servers"
		);
	}

	const asMetadata = await discoverAuthorizationServerMetadata(asUrl, {
		fetchFn: ssrfSafeFetch as unknown as typeof fetch,
		protocolVersion: PROTOCOL_VERSION,
	});
	if (!asMetadata) {
		throw new Error(`Could not load authorization server metadata for ${asUrl}`);
	}

	let clientInfo: OAuthClientInformationFull | undefined;
	const supportsDcr = Boolean(asMetadata.registration_endpoint);
	if (supportsDcr) {
		try {
			const hostname = (() => {
				try {
					return new URL(serverUrl).hostname;
				} catch {
					return serverUrl;
				}
			})();
			clientInfo = await registerClient(asUrl, {
				metadata: asMetadata,
				clientMetadata: {
					redirect_uris: [options.redirectUri],
					token_endpoint_auth_method: "none",
					grant_types: ["authorization_code", "refresh_token"],
					response_types: ["code"],
					client_name: `${options.appName} – ${hostname}`,
					scope: asMetadata.scopes_supported?.join(" "),
					logo_uri: undefined,
					tos_uri: undefined,
				},
				fetchFn: ssrfSafeFetch as unknown as typeof fetch,
			});
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
		supportsDcr,
	};
}
