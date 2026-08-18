import { Client, type ClientCapabilities } from "@modelcontextprotocol/client";
/**
 * Empty on purpose: a capability declared without a handler makes servers issue a
 * request the SDK can only answer with method-not-found. Add one only in the change
 * that implements its handler.
 */
export const MCP_CLIENT_CAPABILITIES: ClientCapabilities = {};

// Servers can tell these apart, so a health probe stays distinguishable from a session.
const CLIENT_INFO = {
	session: { name: "chat-ui-mcp", version: "0.1.0" },
	health: { name: "chat-ui-health-check", version: "1.0.0" },
} as const;

export type McpClientKind = keyof typeof CLIENT_INFO;

/**
 * The one place an MCP client is constructed. Only the pooled client is alive while a
 * tool runs, so a capability added to the listing client in `tools.ts` instead of here
 * would look declared and never fire.
 */
export function createMcpClient(kind: McpClientKind = "session"): Client {
	return new Client(CLIENT_INFO[kind], {
		capabilities: MCP_CLIENT_CAPABILITIES,
		// The SDK defaults to `legacy`, i.e. never negotiating. Probe instead, and let the
		// probe fall back on its own for the 2025-era servers that are still the majority.
		versionNegotiation: { mode: "auto" },
	});
}
