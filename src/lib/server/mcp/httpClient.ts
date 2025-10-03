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
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), timeoutMs);

	const client = new Client({ name: "chat-ui-mcp", version: "0.1.0" });
	const url = toUrl(server.url);

	const normalizedArgs =
		typeof args === "object" && args !== null && !Array.isArray(args)
			? (args as Record<string, unknown>)
			: undefined;

	async function connectStreamable() {
		const transport = new StreamableHTTPClientTransport(url, {
			requestInit: { headers: server.headers },
		});
		await client.connect(transport);
	}

	async function connectSse() {
		const transport = new SSEClientTransport(url, {
			requestInit: { headers: server.headers },
		});
		await client.connect(transport);
	}

	try {
		let usingSse = false;
		try {
			await connectStreamable();
		} catch {
			await connectSse();
			usingSse = true;
		}

		const runTool = async () => client.callTool({ name: tool, arguments: normalizedArgs });
		type CallToolResult = Awaited<ReturnType<typeof runTool>>;

		const raceWithTimeout = <T>(promise: Promise<T>) =>
			Promise.race([
				promise,
				new Promise<never>((_, reject) => {
					controller.signal.addEventListener(
						"abort",
						() => reject(new Error("MCP tool call timed out")),
						{
							once: true,
						}
					);
				}),
			]);

		let response: CallToolResult;
		try {
			response = await raceWithTimeout(runTool());
		} catch (error) {
			if (usingSse) throw error;
			try {
				await client.close?.();
			} catch {
				// ignore close errors
			}
			await connectSse();
			usingSse = true;
			response = await raceWithTimeout(runTool());
		}

		const parts = Array.isArray(response?.content) ? (response.content as Array<unknown>) : [];
		const textParts = parts
			.filter((part): part is { type: "text"; text: string } => {
				if (typeof part !== "object" || part === null) return false;
				const candidate = part as { type?: unknown; text?: unknown };
				return candidate.type === "text" && typeof candidate.text === "string";
			})
			.map((part) => part.text);

		if (textParts.length > 0) {
			return textParts.join("\n");
		}

		return JSON.stringify(response);
	} finally {
		clearTimeout(timeout);
		try {
			await client.close?.();
		} catch {
			// ignore close errors
		}
	}
}
