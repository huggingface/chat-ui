import {
	OAuthClientInformationFullSchema,
	OAuthMetadataSchema,
	OpenIdProviderDiscoveryMetadataSchema,
	type AuthorizationServerMetadata,
	type OAuthClientInformationFull,
	type OAuthProtectedResourceMetadata,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { isValidUrl } from "$lib/server/urlSafety";

const AuthorizationServerMetadataSchema = OAuthMetadataSchema.or(
	OpenIdProviderDiscoveryMetadataSchema
);

/**
 * OAuth endpoints are fetched by the server and therefore must satisfy the
 * shared outbound URL policy in addition to OAuth's HTTPS requirements.
 */
export function assertSafeOAuthUrl(value: string | URL, label: string): URL {
	const raw = value.toString();
	if (!isValidUrl(raw)) {
		throw new Error(`${label} must be a public HTTPS URL`);
	}

	const url = new URL(raw);
	if (url.username || url.password) {
		throw new Error(`${label} must not contain URL credentials`);
	}
	if (url.hash) {
		throw new Error(`${label} must not contain a fragment`);
	}
	return url;
}

export function parseAuthorizationServerMetadata(input: unknown): AuthorizationServerMetadata {
	const metadata = AuthorizationServerMetadataSchema.parse(input);

	const issuer = assertSafeOAuthUrl(metadata.issuer, "Authorization server issuer");
	if (issuer.search) {
		throw new Error("Authorization server issuer must not contain a query");
	}

	assertSafeOAuthUrl(metadata.authorization_endpoint, "Authorization endpoint");
	assertSafeOAuthUrl(metadata.token_endpoint, "Token endpoint");
	if (metadata.registration_endpoint) {
		assertSafeOAuthUrl(metadata.registration_endpoint, "Registration endpoint");
	}
	const revocationEndpoint = (metadata as unknown as Record<string, unknown>).revocation_endpoint;
	if (typeof revocationEndpoint === "string") {
		assertSafeOAuthUrl(revocationEndpoint, "Revocation endpoint");
	}

	return metadata;
}

export function parseClientInformation(input: unknown): OAuthClientInformationFull {
	const client = OAuthClientInformationFullSchema.parse(input);
	if (!client.client_id.trim()) {
		throw new Error("OAuth client_id must not be empty");
	}
	return client;
}

export function assertPkceS256Supported(metadata: AuthorizationServerMetadata): void {
	if (!metadata.code_challenge_methods_supported?.includes("S256")) {
		throw new Error("Authorization server metadata must advertise PKCE S256 support");
	}
}

function comparableUrl(value: string | URL): string {
	return new URL(value.toString()).href;
}

/**
 * RFC 8414 §3.3 requires the returned issuer to be identical to the issuer
 * used to obtain the authorization-server metadata.
 */
export function assertIssuerMatches(
	expectedIssuer: string | URL,
	metadata: AuthorizationServerMetadata
): void {
	const expected = assertSafeOAuthUrl(expectedIssuer, "Advertised authorization server");
	if (comparableUrl(expected) !== comparableUrl(metadata.issuer)) {
		throw new Error(
			`Authorization server issuer mismatch: expected ${expected.href}, received ${metadata.issuer}`
		);
	}
}

/**
 * RFC 9728 §3.3 requires clients to bind protected-resource metadata to the
 * resource for which it was requested.
 */
export function assertProtectedResourceMatches(
	expectedResource: string | URL,
	metadata: OAuthProtectedResourceMetadata
): void {
	const expected = assertSafeOAuthUrl(expectedResource, "MCP resource");
	const actual = assertSafeOAuthUrl(metadata.resource, "Protected resource metadata resource");
	if (comparableUrl(expected) !== comparableUrl(actual)) {
		throw new Error(
			`Protected resource metadata mismatch: expected ${expected.href}, received ${actual.href}`
		);
	}
}
