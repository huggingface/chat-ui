import { config } from "$lib/server/config";

/**
 * Resolve the externally-visible origin used to build OAuth/OIDC redirect and
 * callback URLs.
 *
 * `config.PUBLIC_ORIGIN` takes priority when set. This matters when chat-ui is
 * served over plain HTTP, or behind a reverse proxy that terminates TLS:
 * SvelteKit's node adapter renders `url.origin` as `https://` in production
 * builds regardless of the actual inbound protocol, unless its own `ORIGIN`
 * env var is set (see https://github.com/sveltejs/kit/issues/3248). Without
 * `PUBLIC_ORIGIN`, that mismatch produces an OAuth callback URI the identity
 * provider never redirects back to, and the login silently fails.
 *
 * Falls back to the request's own origin when `PUBLIC_ORIGIN` is unset,
 * which is the common case (a reverse proxy already serving HTTPS).
 */
export function resolveExternalOrigin(url: URL): string {
	const configured = config.PUBLIC_ORIGIN;
	if (!configured) return url.origin;

	try {
		// Normalize through `URL.origin`, which never has a trailing slash: a
		// PUBLIC_ORIGIN pasted with one (e.g. "https://chat.example.com/", a
		// common way to represent a public URL) would otherwise survive verbatim
		// into `${origin}${base}/login/callback`, producing a double slash that
		// doesn't match the registered OAuth redirect URI.
		return new URL(configured).origin;
	} catch {
		// Not a parseable absolute URL -- fall back to trimming a trailing slash
		// rather than letting a malformed config value throw inside the OAuth flow.
		return configured.replace(/\/+$/, "");
	}
}
