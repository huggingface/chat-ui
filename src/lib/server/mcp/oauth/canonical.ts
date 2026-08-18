/** Canonicalize an MCP server URL per RFC 8707 §2: lowercase scheme/host, reject fragments/credentials, drop the parser's implicit root slash, keep path & query verbatim. Throws if not valid HTTP(S). */
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
