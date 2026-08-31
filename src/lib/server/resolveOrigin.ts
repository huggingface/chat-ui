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
	return config.PUBLIC_ORIGIN || url.origin;
}
