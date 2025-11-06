import { Client } from "@modelcontextprotocol/sdk/client";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

export interface McpServerConfig {
	name: string;
	url: string;
	headers?: Record<string, string>;
}

const DEFAULT_TIMEOUT_MS = 30_000;

function toUrl(value: string): URL {
	try {
		return new URL(value);
	} catch (error) {
		throw new Error(`Invalid MCP server URL: ${value}`, { cause: error });
	}
}

export async function callMcpTool(
	server: McpServerConfig,
	tool: string,
	args: unknown = {},
	{ timeoutMs = DEFAULT_TIMEOUT_MS }: { timeoutMs?: number } = {}
): Promise<string> {
	const url = toUrl(server.url);
	const normalizedArgs =
		typeof args === "object" && args !== null && !Array.isArray(args)
			? (args as Record<string, unknown>)
			: undefined;

	async function connect(kind: "streamable" | "sse", signal: AbortSignal, client: Client) {
		const requestInit: RequestInit = { headers: server.headers, signal };
		const transport =
			kind === "streamable"
				? new StreamableHTTPClientTransport(url, { requestInit })
				: new SSEClientTransport(url, { requestInit });
		await client.connect(transport);
	}

	let lastError: unknown;

	for (const kind of ["streamable", "sse"] as const) {
		const controller = new AbortController();
		const client = new Client({ name: "chat-ui-mcp", version: "0.1.0" });
		const timeout = setTimeout(() => controller.abort(), timeoutMs);

		try {
			await connect(kind, controller.signal, client);
			const response = await client.callTool({ name: tool, arguments: normalizedArgs });
			const parts = Array.isArray(response?.content) ? (response.content as Array<unknown>) : [];
			const textParts = parts
				.filter((part): part is { type: "text"; text: string } => {
					if (typeof part !== "object" || part === null) return false;
					const obj = part as Record<string, unknown>;
					return obj["type"] === "text" && typeof obj["text"] === "string";
				})
				.map((p) => p.text);
			return textParts.join("\n");
		} catch (err) {
			lastError = err;
		} finally {
			clearTimeout(timeout);
			try {
				await client.close?.();
			} catch {
				// ignore close errors
			}
		}
	}

	throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
