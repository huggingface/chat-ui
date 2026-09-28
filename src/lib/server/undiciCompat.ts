/**
 * `urlSafety` imports undici, and undici's entrypoint installs itself as the process-wide
 * dispatcher under a symbol Node's own `fetch` reads too — so once any MCP code has loaded,
 * every `fetch` in the process is dispatched by this undici rather than Node's bundled one.
 * Node appends its own content-length to one the caller already set, and this undici rejects
 * the resulting `"113, 113"`, failing every model request with "invalid content-length
 * header". The dispatcher is installed non-configurable, so it cannot be handed back.
 *
 * Dropping the header is lossless: Node computes the right one from the body.
 */
export function withoutContentLength(init?: RequestInit): RequestInit | undefined {
	if (!init?.headers) return init;
	const headers = new Headers(init.headers);
	if (!headers.has("content-length")) return init;
	headers.delete("content-length");
	return { ...init, headers };
}
