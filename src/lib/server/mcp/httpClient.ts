import { Client } from "@modelcontextprotocol/sdk/client";
import { getClient, evictFromPool } from "./clientPool";
import { isExaServer, getExaApiKey, callExaDirectApi } from "./exaDirect";

function isConnectionClosedError(err: unknown): boolean {
	const message = err instanceof Error ? err.message : String(err);
	return message.includes("-32000") || message.toLowerCase().includes("connection closed");
}

export interface McpServerConfig {
	name: string;
	url: string;
	headers?: Record<string, string>;
}

const DEFAULT_TIMEOUT_MS = 30_000;

export type McpToolTextResponse = {
	text: string;
	/** If the server returned structuredContent, include it raw */
	structured?: unknown;
	/** Raw content blocks returned by the server, if any */
	content?: unknown[];
};

export async function callMcpTool(
	server: McpServerConfig,
	tool: string,
	args: unknown = {},
	{
		timeoutMs = DEFAULT_TIMEOUT_MS,
		signal,
		client,
	}: { timeoutMs?: number; signal?: AbortSignal; client?: Client } = {}
): Promise<McpToolTextResponse> {
	// Bypass MCP protocol for Exa - call direct API
	if (isExaServer(server)) {
		const apiKey = getExaApiKey(server);
		if (!apiKey) {
			throw new Error(
				"Exa API key not found. Set EXA_API_KEY environment variable or add ?exaApiKey= to the server URL."
			);
		}
		const normalizedArgs =
			typeof args === "object" && args !== null && !Array.isArray(args)
				? (args as Record<string, unknown>)
				: {};
		return callExaDirectApi(tool, normalizedArgs, apiKey, { signal, timeoutMs });
	}

	const normalizedArgs =
		typeof args === "object" && args !== null && !Array.isArray(args)
			? (args as Record<string, unknown>)
			: undefined;

	// Get a (possibly pooled) client. The client itself was connected with a signal
	// that already composes outer cancellation. We still enforce a per-call timeout here.
	let activeClient = client ?? (await getClient(server, signal));

	const callToolOptions = {
		signal,
		timeout: timeoutMs,
		// Enable progress tokens so long-running tools keep extending the timeout.
		onprogress: () => {},
		resetTimeoutOnProgress: true,
	};

	let response;
	try {
		response = await activeClient.callTool(
			{ name: tool, arguments: normalizedArgs },
			undefined,
			callToolOptions
		);
	} catch (err) {
		if (!isConnectionClosedError(err)) {
			throw err;
		}

		// Evict stale client and close it
		const stale = evictFromPool(server);
		stale?.close?.().catch(() => {});

		// Retry with fresh client
		activeClient = await getClient(server, signal);
		response = await activeClient.callTool(
			{ name: tool, arguments: normalizedArgs },
			undefined,
			callToolOptions
		);
	}

	const parts = Array.isArray(response?.content) ? (response.content as Array<unknown>) : [];
	const textParts = parts
		.filter((part): part is { type: "text"; text: string } => {
			if (typeof part !== "object" || part === null) return false;
			const obj = part as Record<string, unknown>;
			return obj["type"] === "text" && typeof obj["text"] === "string";
		})
		.map((p) => p.text);

	const text = textParts.join("\n");
	const structured = (response as unknown as { structuredContent?: unknown })?.structuredContent;
	const contentBlocks = Array.isArray(response?.content)
		? (response.content as unknown[])
		: undefined;
	return { text, structured, content: contentBlocks };
}
