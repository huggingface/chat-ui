import { Client } from "@modelcontextprotocol/sdk/client";
import { getClient } from "./clientPool";

export interface McpServerConfig {
	name: string;
	url: string;
	headers?: Record<string, string>;
}

const DEFAULT_TIMEOUT_MS = 30_000;

interface AbortSignalWithTimeout {
	timeout?: (ms: number) => AbortSignal;
}
function makeTimeoutSignal(ms: number): AbortSignal {
	const AS = AbortSignal as unknown as AbortSignalWithTimeout;
	if (typeof AS.timeout === "function") return AS.timeout(ms);
	const c = new AbortController();
	setTimeout(() => c.abort(), ms);
	return c.signal;
}

export async function callMcpTool(
	server: McpServerConfig,
	tool: string,
	args: unknown = {},
	{
		timeoutMs = DEFAULT_TIMEOUT_MS,
		signal,
		client,
	}: { timeoutMs?: number; signal?: AbortSignal; client?: Client } = {}
): Promise<string> {
	const normalizedArgs =
		typeof args === "object" && args !== null && !Array.isArray(args)
			? (args as Record<string, unknown>)
			: undefined;

	// Get a (possibly pooled) client. The client itself was connected with a signal
	// that already composes outer cancellation. We still enforce a per-call timeout here.
	const activeClient = client ?? (await getClient(server, signal));

	const timeoutSignal = makeTimeoutSignal(timeoutMs);

	// Per-call timeout wrapper; does not guarantee server abort, but prevents hanging our turn.
	const withTimeout = <T>(p: Promise<T>): Promise<T> =>
		new Promise<T>((resolve, reject) => {
			let settled = false;
			const onAbort = () => {
				if (!settled) {
					settled = true;
					reject(new Error("MCP tool call timed out"));
				}
			};
			timeoutSignal.addEventListener("abort", onAbort);
			p.then((v) => {
				if (!settled) {
					settled = true;
					timeoutSignal.removeEventListener("abort", onAbort);
					resolve(v);
				}
			}).catch((e) => {
				if (!settled) {
					settled = true;
					timeoutSignal.removeEventListener("abort", onAbort);
					reject(e);
				}
			});
		});

	const response = await withTimeout(
		activeClient.callTool({ name: tool, arguments: normalizedArgs })
	);
	const parts = Array.isArray(response?.content) ? (response.content as Array<unknown>) : [];
	const textParts = parts
		.filter((part): part is { type: "text"; text: string } => {
			if (typeof part !== "object" || part === null) return false;
			const obj = part as Record<string, unknown>;
			return obj["type"] === "text" && typeof obj["text"] === "string";
		})
		.map((p) => p.text);

	// Minimal enhancement: if the server provided structuredContent, append its JSON
	// to the textual output so downstream consumers can optionally parse it.
	const text = textParts.join("\n");
	const structured = (response as unknown as { structuredContent?: unknown })?.structuredContent;
	if (structured !== undefined) {
		const json = typeof structured === "string" ? structured : JSON.stringify(structured);
		return text ? `${text}\n\n${json}` : json;
	}
	return text;
}
