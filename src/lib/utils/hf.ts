// Client-safe HF utilities used in UI components

const HF_MCP_HOSTS = new Set(["hf.co", "huggingface.co"]);

/**
 * Query keys a Hub MCP URL may carry and still count as the login endpoint.
 * `bouquet` only picks one of the server's own tool presets, so it cannot change
 * where a forwarded token goes. `gradio` is the one this keeps out: the server
 * hands the token to any private Space named there, and a user-added entry could
 * name one of theirs.
 */
const LOGIN_ENDPOINT_PARAMS = new Set(["login", "bouquet"]);

/**
 * Whether a URL is the Hub MCP login endpoint: `login`, plus at most a bouquet.
 * This gates forwarding the user's HF token, so it fails closed on everything
 * else — a trailing slash, another host, any other query key.
 */
export function isStrictHfMcpLogin(urlString: string): boolean {
	try {
		const u = new URL(urlString);
		if (u.protocol !== "https:" || !HF_MCP_HOSTS.has(u.hostname.toLowerCase())) return false;
		if (u.pathname !== "/mcp") return false;
		const keys = [...u.searchParams.keys()];
		return keys.includes("login") && keys.every((key) => LOGIN_ENDPOINT_PARAMS.has(key));
	} catch {
		return false;
	}
}
