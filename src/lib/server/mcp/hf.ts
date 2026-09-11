// Minimal shared helpers for HF MCP token forwarding

export { isStrictHfMcpLogin } from "$lib/utils/hf";

export const hasAuthHeader = (h?: Record<string, string>) =>
	!!h && Object.keys(h).some((k) => k.toLowerCase() === "authorization");

export const hasNonEmptyToken = (tok: unknown): tok is string =>
	typeof tok === "string" && tok.trim().length > 0;

/**
 * Whether a server URL is the Hub's MCP endpoint at all, login variant or not.
 * The budget gate keys on this: job tools reached through any hf.co/mcp entry
 * spend real money, whichever query string the entry carries.
 */
export const isHfMcpServer = (urlString: string): boolean => {
	try {
		const u = new URL(urlString);
		const host = u.hostname.toLowerCase();
		// Trailing slashes are canonicalized away: `https://hf.co/mcp/` dispatches
		// tools exactly like the bare path, so an exact-path check here would let
		// a one-character config typo route job submissions around the gate.
		return (
			u.protocol === "https:" &&
			(host === "hf.co" || host === "huggingface.co") &&
			u.pathname.replace(/\/+$/, "") === "/mcp"
		);
	} catch {
		return false;
	}
};

export const isExaMcpServer = (urlString: string): boolean => {
	try {
		const u = new URL(urlString);
		return u.protocol === "https:" && u.hostname.toLowerCase() === "mcp.exa.ai";
	} catch {
		return false;
	}
};
