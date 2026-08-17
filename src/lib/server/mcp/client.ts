import { Client } from "@modelcontextprotocol/sdk/client";
import { ElicitRequestSchema, type ClientCapabilities } from "@modelcontextprotocol/sdk/types.js";
import { isElicitationEnabled } from "./elicitationConfig";

/**
 * A capability declared without a handler makes servers issue a request the SDK can only
 * answer with method-not-found. Add one only in the change that implements its handler.
 *
 * `elicitation` is declared for session clients only. A health probe has no chat behind
 * it, so a server that asked it for user input would be told to wait on a screen nobody
 * is looking at.
 */
export function mcpClientCapabilities(kind: McpClientKind): ClientCapabilities {
	// Both modes spelled out: a bare `elicitation: {}` is read as `{ form: {} }`, and the
	// server SDK then refuses to send a URL elicitation at all ("Client does not support
	// url elicitation") — the handler for it would never run.
	return kind === "session" && isElicitationEnabled() ? { elicitation: { form: {}, url: {} } } : {};
}

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
	const capabilities = mcpClientCapabilities(kind);
	const client = new Client(CLIENT_INFO[kind], { capabilities });

	if (capabilities.elicitation) {
		// Imported on demand: the handler reaches the database, and a static edge from here
		// would drag a Mongo connection into every module that only wants to build a client.
		client.setRequestHandler(ElicitRequestSchema, async (request, extra) => {
			const { handleElicitationRequest } = await import("./elicitation");
			// `extra.signal` fires when the server sends `notifications/cancelled` for this
			// request — i.e. it stopped waiting for the answer. Without it we would keep a
			// form on screen that can no longer be answered.
			return handleElicitationRequest(client, request.params, extra.signal);
		});
	}

	return client;
}
