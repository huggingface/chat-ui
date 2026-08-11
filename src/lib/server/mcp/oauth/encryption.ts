import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { config } from "$lib/server/config";
import { logger } from "$lib/server/logger";
import type { MCPClientInformation, MCPOAuthTokens } from "$lib/types/Tool";
import type { MCPOAuthAuthorizationFlow, MCPOAuthConnection } from "$lib/types/MCPOAuthConnection";

// Marker on encrypted values so decryption can pass through legacy plaintext (and key-unset writes)
// untouched, giving a lazy migration path as records are rewritten.
const ENC_PREFIX = "enc.v1:";
const IV_BYTES = 12;
const TAG_BYTES = 16;

// undefined = not resolved yet, null = no key configured (plaintext at rest).
let cachedKey: Buffer | null | undefined;
let warnedNoKey = false;

function getKey(): Buffer | null {
	if (cachedKey !== undefined) return cachedKey;
	const raw = (config.MCP_OAUTH_ENCRYPTION_KEY ?? "").trim();
	if (!raw) {
		cachedKey = null;
		if (!warnedNoKey) {
			warnedNoKey = true;
			logger.warn(
				"[mcp-oauth] MCP_OAUTH_ENCRYPTION_KEY is not set; OAuth credentials are stored unencrypted. Set it to encrypt tokens, client secrets, and PKCE verifiers at rest."
			);
		}
		return null;
	}
	cachedKey = createHash("sha256").update(raw).digest();
	return cachedKey;
}

export function encryptSecret(plaintext: string): string {
	const key = getKey();
	if (!key) return plaintext;
	const iv = randomBytes(IV_BYTES);
	const cipher = createCipheriv("aes-256-gcm", key, iv);
	const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
	const tag = cipher.getAuthTag();
	return ENC_PREFIX + Buffer.concat([iv, tag, ciphertext]).toString("base64");
}

export function decryptSecret(value: string): string {
	if (!value.startsWith(ENC_PREFIX)) return value;
	const key = getKey();
	// Encrypted at rest but no (or wrong) key now: fail closed to an empty value so the caller
	// re-authorizes instead of sending garbage to the server.
	if (!key) return "";
	try {
		const raw = Buffer.from(value.slice(ENC_PREFIX.length), "base64");
		const iv = raw.subarray(0, IV_BYTES);
		const tag = raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
		const ciphertext = raw.subarray(IV_BYTES + TAG_BYTES);
		const decipher = createDecipheriv("aes-256-gcm", key, iv);
		decipher.setAuthTag(tag);
		return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
	} catch {
		return "";
	}
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

// A copy of a stored connection with every secret field decrypted for use. Metadata (expiry, scope,
// client_id, the flow's CSRF state) is untouched, so projections and lookups keep working.
export function decryptConnection(connection: MCPOAuthConnection): MCPOAuthConnection {
	const out = { ...connection };
	if (out.tokens) out.tokens = mapTokenSecrets(out.tokens, decryptSecret);
	if (out.clientInfo) out.clientInfo = mapClientSecret(out.clientInfo, decryptSecret);
	if (out.flow?.verifier) out.flow = { ...out.flow, verifier: decryptSecret(out.flow.verifier) };
	return out;
}
