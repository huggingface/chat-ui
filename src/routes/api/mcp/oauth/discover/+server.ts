import type { RequestHandler } from "./$types";
import { isValidUrl } from "$lib/server/urlSafety";

interface DiscoveryRequest {
	url: string;
}

interface OAuthServerMetadata {
	issuer: string;
	authorization_endpoint: string;
	token_endpoint: string;
	registration_endpoint?: string;
	scopes_supported?: string[];
	response_types_supported?: string[];
	code_challenge_methods_supported?: string[];
	token_endpoint_auth_methods_supported?: string[];
	grant_types_supported?: string[];
}

interface ProtectedResourceMetadata {
	resource: string;
	authorization_servers?: string[];
	scopes_supported?: string[];
}

function parseResourceMetadataUrl(wwwAuthenticate: string): string | null {
	const match = wwwAuthenticate.match(/resource_metadata="([^"]+)"/);
	return match?.[1] ?? null;
}

async function fetchJson<T>(url: string, signal: AbortSignal): Promise<T | null> {
	try {
		const response = await fetch(url, {
			headers: { Accept: "application/json" },
			signal,
		});
		if (!response.ok) return null;
		return (await response.json()) as T;
	} catch {
		return null;
	}
}

async function fetchAuthServerMetadata(
	issuerUrl: string,
	signal: AbortSignal
): Promise<OAuthServerMetadata | null> {
	const url = new URL(issuerUrl);
	const wellKnownUrl = `${url.origin}/.well-known/oauth-authorization-server`;
	const metadata = await fetchJson<OAuthServerMetadata>(wellKnownUrl, signal);

	if (!metadata?.authorization_endpoint || !metadata?.token_endpoint) return null;
	if (
		metadata.code_challenge_methods_supported &&
		!metadata.code_challenge_methods_supported.includes("S256")
	) {
		return null;
	}
	return metadata;
}

export const POST: RequestHandler = async ({ request }) => {
	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), 15000);

	try {
		const body: DiscoveryRequest = await request.json();
		const { url } = body;

		if (!url || !isValidUrl(url)) {
			return new Response(JSON.stringify({ error: "Invalid URL" }), {
				status: 400,
				headers: { "Content-Type": "application/json" },
			});
		}

		// RFC 9728: Probe the server to get resource_metadata from WWW-Authenticate
		const probeResponse = await fetch(url, {
			method: "GET",
			signal: controller.signal,
		});

		if (probeResponse.status === 401) {
			const wwwAuth = probeResponse.headers.get("www-authenticate") ?? "";
			const prmUrl = parseResourceMetadataUrl(wwwAuth);

			if (prmUrl) {
				const prm = await fetchJson<ProtectedResourceMetadata>(prmUrl, controller.signal);
				if (prm?.authorization_servers?.[0]) {
					const metadata = await fetchAuthServerMetadata(
						prm.authorization_servers[0],
						controller.signal
					);
					if (metadata) {
						clearTimeout(timeoutId);
						return new Response(JSON.stringify({ metadata }), {
							headers: { "Content-Type": "application/json" },
						});
					}
				}
			}
		}

		// Fallback: same-origin well-known
		const metadata = await fetchAuthServerMetadata(url, controller.signal);
		clearTimeout(timeoutId);

		if (metadata) {
			return new Response(JSON.stringify({ metadata }), {
				headers: { "Content-Type": "application/json" },
			});
		}

		return new Response(JSON.stringify({ metadata: null }), {
			headers: { "Content-Type": "application/json" },
		});
	} catch (error) {
		clearTimeout(timeoutId);
		return new Response(
			JSON.stringify({ error: error instanceof Error ? error.message : "Discovery failed" }),
			{ status: 500, headers: { "Content-Type": "application/json" } }
		);
	}
};
