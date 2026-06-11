import { Client } from "@modelcontextprotocol/sdk/client";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type { McpServerConfig } from "./httpClient";
import { ssrfSafeFetch } from "$lib/server/urlSafety";

type PoolEntry = { client: Client; lastUsedAt: number; activeCalls: number };

const pool = new Map<string, PoolEntry>();

// Reuse a recently-used client as-is; ping it first if it has been idle longer than this,
// since proxies / load balancers silently reap idle connections.
const PING_AFTER_IDLE_MS = 30_000;
const PING_TIMEOUT_MS = 5_000;
// Close clients idle longer than this. Must stay well above MCP tool timeouts so the sweeper
// never closes a client with an in-flight call.
const IDLE_TTL_MS = 10 * 60_000;
const SWEEP_INTERVAL_MS = 60_000;

let sweeper: ReturnType<typeof setInterval> | undefined;

// Dispose of a still-healthy pooled client. Per the MCP Streamable HTTP spec, clients
// SHOULD explicitly terminate sessions they no longer need (HTTP DELETE) before dropping
// the connection; servers that don't support it reply 405, which the SDK treats as ok.
async function disposeClient(client: Client) {
	const transport = client.transport;
	if (transport instanceof StreamableHTTPClientTransport) {
		await transport.terminateSession().catch(() => {});
	}
	await client.close?.().catch(() => {});
}

function ensureSweeper() {
	if (sweeper) return;
	sweeper = setInterval(() => {
		const now = Date.now();
		for (const [key, entry] of pool) {
			if (entry.activeCalls === 0 && now - entry.lastUsedAt > IDLE_TTL_MS) {
				pool.delete(key);
				void disposeClient(entry.client);
			}
		}
	}, SWEEP_INTERVAL_MS);
	sweeper.unref?.();
}

function keyOf(server: McpServerConfig) {
	const headers = Object.entries(server.headers ?? {})
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([k, v]) => `${k}:${v}`)
		.join("|\u0000|");
	return `${server.url}|${headers}`;
}

export async function getClient(server: McpServerConfig, signal?: AbortSignal): Promise<Client> {
	const key = keyOf(server);
	const existing = pool.get(key);
	if (existing) {
		if (Date.now() - existing.lastUsedAt <= PING_AFTER_IDLE_MS) {
			existing.lastUsedAt = Date.now();
			return existing.client;
		}
		try {
			await existing.client.ping({ signal, timeout: PING_TIMEOUT_MS });
			existing.lastUsedAt = Date.now();
			return existing.client;
		} catch (err) {
			if (signal?.aborted) throw err;
			// Stale connection; evict it (unless a concurrent caller already replaced it) and reconnect.
			if (pool.get(key) === existing) pool.delete(key);
			existing.client.close?.().catch(() => {});
		}
	}

	let firstError: unknown;
	const client = new Client({ name: "chat-ui-mcp", version: "0.1.0" });
	const url = new URL(server.url);
	// Pooled clients outlive the request that created them, so never bind the per-request
	// abort signal to the transport. Per-call cancellation goes through RequestOptions instead.
	const requestInit: RequestInit = { headers: server.headers };
	try {
		try {
			await client.connect(
				new StreamableHTTPClientTransport(url, { requestInit, fetch: ssrfSafeFetch })
			);
		} catch (httpErr) {
			// Remember the original HTTP transport error so we can surface it if the fallback also fails.
			// Today we always show the SSE message, which is misleading when the real failure was HTTP (e.g. 500).
			firstError = httpErr;
			await client.connect(new SSEClientTransport(url, { requestInit, fetch: ssrfSafeFetch }));
		}
	} catch (err) {
		try {
			await client.close?.();
		} catch {}
		// Prefer the HTTP error if both transports fail; otherwise fall back to the last error.
		if (firstError) {
			const message =
				"HTTP transport failed: " +
				String(firstError instanceof Error ? firstError.message : firstError) +
				"; SSE fallback failed: " +
				String(err instanceof Error ? err.message : err);
			throw new Error(message, { cause: err instanceof Error ? err : undefined });
		}
		throw err;
	}

	pool.set(key, { client, lastUsedAt: Date.now(), activeCalls: 0 });
	ensureSweeper();
	return client;
}

/** Mark a pooled client as having an in-flight call so the sweeper won't close it. */
export function retainClient(client: Client) {
	for (const entry of pool.values()) {
		if (entry.client === client) {
			entry.activeCalls++;
			return;
		}
	}
}

export function releaseClient(client: Client) {
	for (const entry of pool.values()) {
		if (entry.client === client) {
			entry.activeCalls = Math.max(0, entry.activeCalls - 1);
			entry.lastUsedAt = Date.now();
			return;
		}
	}
}

export async function drainPool() {
	for (const [key, entry] of pool) {
		await disposeClient(entry.client);
		pool.delete(key);
	}
}

export function evictFromPool(server: McpServerConfig): Client | undefined {
	const key = keyOf(server);
	const entry = pool.get(key);
	if (entry) {
		pool.delete(key);
	}
	return entry?.client;
}
