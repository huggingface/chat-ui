import { Client } from "@modelcontextprotocol/sdk/client";
import { StreamableHTTPError } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { getClient, evictFromPool, retainClient, releaseClient } from "./clientPool";
import { withElicitationContext, type ElicitationSink } from "./elicitation";
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

/** Time the server may go without responding; waiting on a user does not count. */
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
	/**
	 * The server reported the call as failed. MCP returns tool failures as a normal
	 * result with `isError: true` and the failure text in the content blocks, so this
	 * never surfaces as a thrown error — callers must check it explicitly.
	 */
	isError: boolean;
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

/** Leak guard only; the deadline below is the real one. */
const ABSOLUTE_CEILING_MS = 6 * 60 * 60_000;

/**
 * Owned here rather than left to the SDK, whose timer only a server-sent progress
 * notification can reset — an elicitation needs to stop the clock while a user thinks.
 */
export function createCallDeadline(timeoutMs: number, outer?: AbortSignal) {
	const controller = new AbortController();
	let timer: ReturnType<typeof setTimeout> | undefined;
	let paused = 0;

	const disarm = () => {
		if (timer) clearTimeout(timer);
		timer = undefined;
	};
	const arm = () => {
		if (timer || paused > 0 || controller.signal.aborted) return;
		timer = setTimeout(
			() => controller.abort(`Tool call exceeded ${timeoutMs}ms without a response`),
			timeoutMs
		);
	};

	const onOuterAbort = () => {
		disarm();
		controller.abort(outer?.reason);
	};
	if (outer?.aborted) controller.abort(outer.reason);
	else outer?.addEventListener("abort", onOuterAbort, { once: true });

	arm();

	return {
		signal: controller.signal,
		restart() {
			disarm();
			arm();
		},
		/** Counted: one call can be asked more than one thing before it finishes. */
		pause() {
			paused++;
			disarm();
		},
		resume() {
			paused = Math.max(0, paused - 1);
			arm();
		},
		dispose() {
			disarm();
			outer?.removeEventListener("abort", onOuterAbort);
		},
	};
}

export type McpCallDeadline = ReturnType<typeof createCallDeadline>;

export async function callMcpTool(
	server: McpServerConfig,
	tool: string,
	args: unknown = {},
	{
		timeoutMs = DEFAULT_TIMEOUT_MS,
		signal,
		client,
		onProgress,
		elicitation,
	}: {
		timeoutMs?: number;
		signal?: AbortSignal;
		client?: Client;
		onProgress?: (progress: McpToolProgress) => void;
		/** Omit and any `elicitation/create` on this connection is declined. */
		elicitation?: { sink: ElicitationSink; toolUuid: string };
	} = {}
): Promise<McpToolTextResponse> {
	const normalizedArgs =
		typeof args === "object" && args !== null && !Array.isArray(args)
			? (args as Record<string, unknown>)
			: undefined;

	// Get a (possibly pooled) client. Cancellation and timeout are enforced per call
	// via the request options below, not on the pooled transport itself.
	let activeClient = client ?? (await getClient(server, signal));

	const deadline = createCallDeadline(timeoutMs, signal);

	const callToolOptions = {
		signal: deadline.signal,
		timeout: ABSOLUTE_CEILING_MS,
		// Enable progress tokens so long-running tools keep extending the timeout.
		onprogress: (progress: McpToolProgress) => {
			deadline.restart();
			onProgress?.({
				progress: progress.progress,
				total: progress.total,
				message: progress.message,
			});
		},
	};

	// The connection can be closed at any point during a (potentially long-running) call,
	// e.g. by a proxy idle timeout or a server restart, so retry on a fresh client.
	const maxReconnectAttempts = 2;
	let response;
	try {
		for (let attempt = 0; ; attempt++) {
			// Keep a stable reference for retain/release: `activeClient` is reassigned on retry.
			const currentClient = activeClient;
			retainClient(currentClient);
			deadline.restart();
			const invoke = () =>
				currentClient.callTool(
					{ name: tool, arguments: normalizedArgs },
					undefined,
					callToolOptions
				);
			try {
				response = elicitation
					? await withElicitationContext(
							currentClient,
							{
								sink: elicitation.sink,
								server: server.name,
								toolUuid: elicitation.toolUuid,
								deadline,
								signal,
							},
							invoke
						)
					: await invoke();
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
	} finally {
		deadline.dispose();
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
	const isError = (response as unknown as { isError?: unknown })?.isError === true;
	return { text, isError, structured, content: contentBlocks };
}
