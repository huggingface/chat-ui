import { Client } from "@modelcontextprotocol/sdk/client";
import { getClient } from "./clientPool";

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
	const normalizedArgs =
		typeof args === "object" && args !== null && !Array.isArray(args)
			? (args as Record<string, unknown>)
			: undefined;

	// Get a (possibly pooled) client. The client itself was connected with a signal
	// that already composes outer cancellation. We still enforce a per-call timeout here.
	const activeClient = client ?? (await getClient(server, signal));

	// Prefer the SDK's built-in request controls (timeout, signal)
	const response = await activeClient.callTool(
		{ name: tool, arguments: normalizedArgs },
		undefined,
		{
			signal,
			timeout: timeoutMs,
			// Enable progress tokens so long-running tools keep extending the timeout.
			onprogress: () => {},
			resetTimeoutOnProgress: true,
		}
	);

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
