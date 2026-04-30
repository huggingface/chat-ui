/**
 * Canonicalize an MCP server URL per RFC 8707 Section 2 / MCP Authorization spec.
 *
 * The canonical form:
 *  - lowercases the scheme and host
 *  - strips any URL fragment
 *  - drops a single trailing slash on the path unless it is the only character
 *    (i.e., the bare-host form `https://host` stays without a slash)
 *  - keeps the path otherwise verbatim (path components can be semantically
 *    significant when a single host serves multiple MCP servers)
 *  - keeps query string verbatim (e.g., the HF login MCP uses `?login`)
 *
 * Throws if the input is not a valid HTTP(S) URL.
 */
export function canonicalizeMcpUri(input: string | URL): string {
	const url = input instanceof URL ? new URL(input.toString()) : new URL(input);

	if (url.protocol !== "https:" && url.protocol !== "http:") {
		throw new Error(`Unsupported scheme for MCP URI: ${url.protocol}`);
	}

	url.hash = "";
	url.protocol = url.protocol.toLowerCase();
	url.hostname = url.hostname.toLowerCase();

	if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
		url.pathname = url.pathname.replace(/\/+$/, "");
	}

	let canonical = url.toString();
	// URL.toString() emits "https://host/" for bare-host inputs; the spec example
	// uses "https://mcp.example.com" without the trailing slash, so strip it
	// when there is no real path.
	if (url.pathname === "/" && canonical.endsWith("/")) {
		canonical = canonical.slice(0, -1);
	}
	return canonical;
}
