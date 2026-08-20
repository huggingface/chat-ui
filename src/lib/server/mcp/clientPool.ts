import { StreamableHTTPClientTransport, SSEClientTransport } from "@modelcontextprotocol/client";
import type { Client } from "@modelcontextprotocol/client";
import { createMcpClient } from "./client";
import type { McpServerConfig } from "./httpClient";
import { mcpFetch } from "$lib/server/urlSafety";

type PoolEntry = {
	client: Client;
	lastUsedAt: number;
	activeCalls: number;
	/** Evicted from the pool; closed once its last in-flight call finishes. */
	retired?: boolean;
};

const pool = new Map<string, PoolEntry>();

/**
 * Entries by client, so retain/release still find one after it leaves the pool, and
 * evicted clients with calls still running can be closed by the last one to finish.
 */
const entries = new Map<Client, PoolEntry>();

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
				entries.delete(entry.client);
				void disposeClient(entry.client);
			}
		}
	}, SWEEP_INTERVAL_MS);
	sweeper.unref?.();
}

function keyOf(server: McpServerConfig, isolation?: string) {
	const headers = Object.entries(server.headers ?? {})
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([k, v]) => `${k}:${v}`)
		.join("|\u0000|");
	return `${server.url}|${headers}|${isolation ?? ""}`;
}

export async function getClient(
	server: McpServerConfig,
	signal?: AbortSignal,
	isolation?: string
): Promise<Client> {
	const key = keyOf(server, isolation);
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
	const client = createMcpClient();
	const url = new URL(server.url);
	// Pooled clients outlive the request that created them, so never bind the per-request
	// abort signal to the transport. Per-call cancellation goes through RequestOptions instead.
	const requestInit: RequestInit = { headers: server.headers };
	try {
		try {
			await client.connect(
				new StreamableHTTPClientTransport(url, { requestInit, fetch: mcpFetch })
			);
		} catch (httpErr) {
			// Remember the original HTTP transport error so we can surface it if the fallback also fails.
			// Today we always show the SSE message, which is misleading when the real failure was HTTP (e.g. 500).
			firstError = httpErr;
			await client.connect(new SSEClientTransport(url, { requestInit, fetch: mcpFetch }));
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

	const entry: PoolEntry = { client, lastUsedAt: Date.now(), activeCalls: 0 };
	pool.set(key, entry);
	entries.set(client, entry);
	ensureSweeper();
	return client;
}

/** Mark a pooled client as having an in-flight call so the sweeper won't close it. */
export function retainClient(client: Client) {
	const entry = entries.get(client);
	if (entry) entry.activeCalls++;
}

export function releaseClient(client: Client) {
	const entry = entries.get(client);
	if (!entry) return;
	entry.activeCalls = Math.max(0, entry.activeCalls - 1);
	entry.lastUsedAt = Date.now();
	// A client is only evicted because it looked broken to one caller. Closing it while
	// another conversation is still mid-call would cancel that call too, so the last one
	// out closes the door.
	if (entry.retired && entry.activeCalls === 0) {
		entries.delete(client);
		void disposeClient(client);
	}
}

export async function drainPool() {
	for (const [key, entry] of pool) {
		await disposeClient(entry.client);
		entries.delete(entry.client);
		pool.delete(key);
	}
}

/**
 * Take a client out of circulation. Returns it only when nothing else is using it, so the
 * caller cannot close a connection another conversation is still talking over.
 */
export function evictFromPool(server: McpServerConfig, isolation?: string): Client | undefined {
	const key = keyOf(server, isolation);
	const entry = pool.get(key);
	if (!entry) return undefined;
	pool.delete(key);
	if (entry.activeCalls > 0) {
		entry.retired = true;
		return undefined;
	}
	entries.delete(entry.client);
	return entry.client;
}

/**
 * A connection an unsolicited `elicitation/create` can be attributed on. A legacy server
 * pushes one down the connection with nothing tying it to a call, so it can only be routed
 * when every call on that connection belongs to the same conversation; sharing one instead
 * means a prompt raised for one chat gets declined because another chat is also mid-call.
 * A modern server answers the call itself, so it keeps the shared connection.
 */
export async function getAttributableClient(
	server: McpServerConfig,
	conversationId: string,
	signal?: AbortSignal
): Promise<{ client: Client; isolation?: string }> {
	const isolation = `conversation:${conversationId}`;
	if (!pool.has(keyOf(server, isolation))) {
		const shared = await getClient(server, signal);
		if (shared.getProtocolEra() === "modern") return { client: shared };
	}
	return { client: await getClient(server, signal, isolation), isolation };
}
