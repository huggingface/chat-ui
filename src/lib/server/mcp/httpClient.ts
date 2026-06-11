import { Client } from "@modelcontextprotocol/sdk/client";
import { StreamableHTTPError } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { getClient, evictFromPool, retainClient, releaseClient } from "./clientPool";
import { config } from "$lib/server/config";

function isConnectionClosedError(err: unknown): boolean {
	const message = err instanceof Error ? err.message : String(err);
	return message.includes("-32000") || message.toLowerCase().includes("connection closed");
}

// Per the MCP Streamable HTTP spec, a 404 on a request carrying a session ID means the
// session expired and the client MUST start a new session with a new InitializeRequest —
// which is exactly what reconnecting with a fresh client does.
function isSessionExpiredError(err: unknown): boolean {
	return err instanceof StreamableHTTPError && err.code === 404;
}

export interface McpServerConfig {
	name: string;
	url: string;
	headers?: Record<string, string>;
}

const DEFAULT_TIMEOUT_MS = 120_000;

export function getMcpToolTimeoutMs(): number {
	const envValue = config.MCP_TOOL_TIMEOUT_MS;
	if (envValue) {
		const parsed = parseInt(envValue, 10);
		if (!isNaN(parsed) && parsed > 0) {
			return parsed;
		}
	}
	return DEFAULT_TIMEOUT_MS;
}

export type McpToolTextResponse = {
	text: string;
	/** If the server returned structuredContent, include it raw */
	structured?: unknown;
	/** Raw content blocks returned by the server, if any */
	content?: unknown[];
};

export type McpToolProgress = {
	progress: number;
	total?: number;
	message?: string;
};

export async function callMcpTool(
	server: McpServerConfig,
	tool: string,
	args: unknown = {},
	{
		timeoutMs = DEFAULT_TIMEOUT_MS,
		signal,
		client,
		onProgress,
	}: {
		timeoutMs?: number;
		signal?: AbortSignal;
		client?: Client;
		onProgress?: (progress: McpToolProgress) => void;
	} = {}
): Promise<McpToolTextResponse> {
	const normalizedArgs =
		typeof args === "object" && args !== null && !Array.isArray(args)
			? (args as Record<string, unknown>)
			: undefined;

	// Get a (possibly pooled) client. Cancellation and timeout are enforced per call
	// via the request options below, not on the pooled transport itself.
	let activeClient = client ?? (await getClient(server, signal));

	const callToolOptions = {
		signal,
		timeout: timeoutMs,
		// Enable progress tokens so long-running tools keep extending the timeout.
		onprogress: (progress: McpToolProgress) => {
			onProgress?.({
				progress: progress.progress,
				total: progress.total,
				message: progress.message,
			});
		},
		resetTimeoutOnProgress: true,
		// The spec requires a maximum total timeout even when progress resets the per-step one.
		maxTotalTimeout: timeoutMs * 10,
	};

	// The connection can be closed at any point during a (potentially long-running) call,
	// e.g. by a proxy idle timeout or a server restart, so retry on a fresh client.
	const maxReconnectAttempts = 2;
	let response;
	for (let attempt = 0; ; attempt++) {
		// Keep a stable reference for retain/release: `activeClient` is reassigned on retry.
		const currentClient = activeClient;
		retainClient(currentClient);
		try {
			response = await currentClient.callTool(
				{ name: tool, arguments: normalizedArgs },
				undefined,
				callToolOptions
			);
			break;
		} catch (err) {
			if (
				attempt >= maxReconnectAttempts ||
				signal?.aborted ||
				!(isConnectionClosedError(err) || isSessionExpiredError(err))
			) {
				throw err;
			}

			// Evict stale client and close it
			const stale = evictFromPool(server);
			stale?.close?.().catch(() => {});

			// Brief backoff before later retries (the server may be mid-restart)
			if (attempt > 0) {
				await new Promise((resolve) => setTimeout(resolve, 1_000 * attempt));
			}
			activeClient = await getClient(server, signal);
		} finally {
			releaseClient(currentClient);
		}
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
