import { Client, type ClientCapabilities } from "@modelcontextprotocol/client";
import { isElicitationEnabled } from "./elicitationConfig";

/**
 * Declare a capability only in the change that implements its handler, or servers issue
 * requests the SDK can only answer with method-not-found. Health probes get none: there is
 * no chat behind them to ask. Spell both elicitation modes out — a bare `elicitation: {}`
 * reads as form-only and the server SDK then refuses to send a URL elicitation at all.
 */
export function mcpClientCapabilities(kind: McpClientKind): ClientCapabilities {
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
	const client = new Client(CLIENT_INFO[kind], {
		capabilities,
		// The SDK defaults to `legacy`, i.e. never negotiating. Probe instead, and let the
		// probe fall back on its own for the 2025-era servers that are still the majority.
		versionNegotiation: { mode: "auto" },
		// A 2026-era prompt outlives this call, so the driver must not block our handler
		// waiting for one. `callMcpTool` opts each call into receiving `input_required`.
		inputRequired: { autoFulfill: false },
	});

	if (capabilities.elicitation) {
		// Imported on demand, or every module building a client drags in a Mongo connection.
		client.setRequestHandler("elicitation/create", async (request, ctx) => {
			const { handleElicitationRequest } = await import("./elicitation");
			// Fires on `notifications/cancelled`, i.e. the server gave up.
			return handleElicitationRequest(client, request.params, ctx.mcpReq.signal);
		});
	}

	return client;
}
