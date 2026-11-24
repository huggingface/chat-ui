import { config } from "$lib/server/config";
import { createSecretBox } from "$lib/server/secretBox";
import type { MCPClientInformation, MCPOAuthTokens } from "$lib/types/Tool";
import type { MCPOAuthAuthorizationFlow, MCPOAuthConnection } from "$lib/types/MCPOAuthConnection";

const box = createSecretBox(
	() => config.MCP_OAUTH_ENCRYPTION_KEY,
	"[mcp-oauth] MCP_OAUTH_ENCRYPTION_KEY is not set; OAuth credentials are stored unencrypted. Set it to encrypt tokens, client secrets, and PKCE verifiers at rest."
);

export function encryptSecret(plaintext: string): string {
	return box.encrypt(plaintext);
}

export function decryptSecret(value: string): string {
	return box.decrypt(value);
}

const TOKEN_SECRET_FIELDS = ["access_token", "refresh_token", "id_token"] as const;

function mapTokenSecrets(tokens: MCPOAuthTokens, fn: (s: string) => string): MCPOAuthTokens {
	const out = { ...tokens };
	for (const field of TOKEN_SECRET_FIELDS) {
		const value = out[field];
		if (typeof value === "string" && value.length > 0) out[field] = fn(value);
	}
	return out;
}

export function encryptTokens(tokens: MCPOAuthTokens): MCPOAuthTokens {
	return mapTokenSecrets(tokens, encryptSecret);
}

function mapClientSecret(
	clientInfo: MCPClientInformation,
	fn: (s: string) => string
): MCPClientInformation {
	if (typeof clientInfo.client_secret !== "string" || clientInfo.client_secret.length === 0) {
		return clientInfo;
	}
	return { ...clientInfo, client_secret: fn(clientInfo.client_secret) };
}

export function encryptClientInfo(clientInfo: MCPClientInformation): MCPClientInformation {
	return mapClientSecret(clientInfo, encryptSecret);
}

export function encryptFlow(flow: MCPOAuthAuthorizationFlow): MCPOAuthAuthorizationFlow {
	if (typeof flow.verifier !== "string" || flow.verifier.length === 0) return flow;
	return { ...flow, verifier: encryptSecret(flow.verifier) };
}

// Only non-empty values are ever encrypted, so an encrypted value that decrypts to "" is a key that
// was unset or rotated, not an empty secret.
function undecryptable(value: unknown): boolean {
	return typeof value === "string" && value.length > 0 && decryptSecret(value) === "";
}

// A copy of a stored connection with every secret field decrypted for use. Metadata (expiry, scope,
// client_id, the flow's CSRF state) is untouched, so projections and lookups keep working. A part
// whose secret can't be decrypted is dropped, so the connection reads as needing re-authorization
// instead of sending an empty bearer while still showing "authorized".
export function decryptConnection(connection: MCPOAuthConnection): MCPOAuthConnection {
	const out = { ...connection };
	if (out.tokens) {
		out.tokens = TOKEN_SECRET_FIELDS.some((field) => undecryptable(out.tokens?.[field]))
			? undefined
			: mapTokenSecrets(out.tokens, decryptSecret);
	}
	if (out.clientInfo) {
		out.clientInfo = undecryptable(out.clientInfo.client_secret)
			? undefined
			: mapClientSecret(out.clientInfo, decryptSecret);
	}
	if (out.flow?.verifier) {
		out.flow = undecryptable(out.flow.verifier)
			? undefined
			: { ...out.flow, verifier: decryptSecret(out.flow.verifier) };
	}
	return out;
}
