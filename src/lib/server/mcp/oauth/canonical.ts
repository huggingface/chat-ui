/**
 * Canonicalize an MCP server URL per RFC 8707 Section 2 / MCP Authorization spec.
 *
 * The canonical form:
 *  - lowercases the scheme and host
 *  - rejects URL fragments and embedded credentials
 *  - keeps a non-root trailing slash because it may be semantically significant
 *  - emits a bare host without the URL parser's implicit root slash
 *  - keeps the path otherwise verbatim (path components can be semantically
 *    significant when a single host serves multiple MCP servers)
 *  - keeps query string verbatim (e.g., the HF login MCP uses `?login`)
 *
 * Throws if the input is not a valid HTTP(S) resource identifier.
 */
export function canonicalizeMcpUri(input: string | URL): string {
	const url = input instanceof URL ? new URL(input.toString()) : new URL(input);

	if (url.protocol !== "https:" && url.protocol !== "http:") {
		throw new Error(`Unsupported scheme for MCP URI: ${url.protocol}`);
	}
	if (url.username || url.password) {
		throw new Error("MCP URI must not contain URL credentials");
	}
	if (url.hash) {
		throw new Error("MCP URI must not contain a fragment");
	}

	url.protocol = url.protocol.toLowerCase();
	url.hostname = url.hostname.toLowerCase();

	// URL.toString() emits "https://host/" for bare-host inputs; the spec example
	// uses "https://mcp.example.com" without the trailing slash, so strip it
	// when there is no real path.
	if (url.pathname === "/") {
		return `${url.origin}${url.search}`;
	}
	return url.toString();
}
