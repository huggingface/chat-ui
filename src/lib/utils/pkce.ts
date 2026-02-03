/**
 * PKCE (Proof Key for Code Exchange) utilities
 * Implements RFC 7636 for OAuth 2.0 public clients
 */

import type { PKCEState } from "$lib/types/McpOAuth";

/**
 * Generate a cryptographically secure random string
 * Uses Web Crypto API for secure random generation
 */
function generateRandomString(length: number): string {
	const array = new Uint8Array(length);
	crypto.getRandomValues(array);
	return Array.from(array, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Base64URL encode a buffer (RFC 7636 compliant)
 * - Uses URL-safe alphabet (- instead of +, _ instead of /)
 * - Removes padding (=)
 */
function base64UrlEncode(buffer: ArrayBuffer): string {
	const bytes = new Uint8Array(buffer);
	let binary = "";
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Generate PKCE code verifier and challenge
 *
 * Per RFC 7636:
 * - code_verifier: 43-128 character random string (we use 64 hex chars = 128 chars)
 * - code_challenge: BASE64URL(SHA256(code_verifier))
 * - code_challenge_method: "S256"
 *
 * @returns PKCEState with verifier, challenge, and state for CSRF protection
 */
export async function generatePKCE(): Promise<PKCEState> {
	// Code verifier: high-entropy random string
	// 64 bytes = 128 hex characters, well within 43-128 char range
	const codeVerifier = generateRandomString(64);

	// Code challenge: SHA-256 hash of verifier, base64url encoded
	const encoder = new TextEncoder();
	const data = encoder.encode(codeVerifier);
	const digest = await crypto.subtle.digest("SHA-256", data);
	const codeChallenge = base64UrlEncode(digest);

	// State parameter for CSRF protection
	const state = generateRandomString(32);

	return { codeVerifier, codeChallenge, state };
}

/**
 * Verify that a code challenge matches a code verifier
 * Used for testing/validation purposes
 */
export async function verifyPKCE(codeVerifier: string, codeChallenge: string): Promise<boolean> {
	const encoder = new TextEncoder();
	const data = encoder.encode(codeVerifier);
	const digest = await crypto.subtle.digest("SHA-256", data);
	const computedChallenge = base64UrlEncode(digest);
	return computedChallenge === codeChallenge;
}
