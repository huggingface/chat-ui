import { Client } from "@modelcontextprotocol/sdk/client";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type { McpServerConfig } from "./httpClient";
import { logger } from "$lib/server/logger";
import { ssrfSafeFetch } from "$lib/server/urlSafety";
// use console.* for lightweight diagnostics in production logs

export type OpenAiTool = {
	type: "function";
	function: { name: string; description?: string; parameters?: Record<string, unknown> };
};

export interface McpToolMapping {
	fnName: string;
	server: string;
	tool: string;
}

// Tool listings are cached per server (url + headers), not per server set, so
// toggling one server never invalidates the others' entries. Headers are part
// of the key because they change what a server returns (e.g. the forwarded HF
// user token yields a per-user tool list on hf.co/mcp); that also means the key
// space grows with active users, hence the size cap.
type CachedServerTool = {
	name: string;
	description?: string;
	parameters?: Record<string, unknown>;
};

interface ServerCacheEntry {
	fetchedAt: number;
	ttlMs: number;
	tools: CachedServerTool[];
}

const DEFAULT_TTL_MS = 60_000;
const MAX_CACHE_ENTRIES = 1_000;
const cache = new Map<string, ServerCacheEntry>();

// Per OpenAI tool/function name guidelines most providers enforce:
//   ^[a-zA-Z0-9_-]{1,64}$
// Dots are not universally accepted (e.g., MiniMax via HF router rejects them).
// Normalize any disallowed characters (including ".") to underscore and trim to 64 chars.
function sanitizeName(name: string) {
	return name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
}

const TYPE_IMPLYING_KEYWORDS = ["enum", "const", "$ref", "anyOf", "oneOf", "allOf", "not"] as const;
const OBJECT_IMPLYING_KEYWORDS = [
	"properties",
	"patternProperties",
	"additionalProperties",
	"propertyNames",
	"required",
] as const;
const ARRAY_IMPLYING_KEYWORDS = ["items", "prefixItems", "contains"] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Normalize an MCP tool's JSON Schema so strict OpenAI-compatible providers
 * (e.g. Fireworks) accept it. Some MCP servers (notably hf.co/mcp's `write_file`)
 * emit properties like `{ description, default: null }` with no `type`; providers
 * reject those under tool_choice:"auto", and one bad tool rejects the whole array.
 * Pure + non-mutating. Only recurses into real schema-bearing keywords, so instance
 * data (required, enum, defaults) and boolean additionalProperties stay intact.
 */
export function sanitizeJsonSchema(schema: Record<string, unknown>): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(schema)) {
		if (key === "default" && value === null) continue; // drop contradictory/uninformative null defaults
		out[key] = value;
	}

	const recurse = (value: unknown): unknown =>
		isPlainObject(value) ? sanitizeJsonSchema(value) : value;
	const recurseMap = (map: Record<string, unknown>): Record<string, unknown> =>
		Object.fromEntries(Object.entries(map).map(([key, sub]) => [key, recurse(sub)]));

	// Object applicators: { name -> schema } maps, plus the key schema.
	if (isPlainObject(out.properties)) out.properties = recurseMap(out.properties);
	if (isPlainObject(out.patternProperties))
		out.patternProperties = recurseMap(out.patternProperties);
	if (isPlainObject(out.propertyNames)) out.propertyNames = sanitizeJsonSchema(out.propertyNames);
	// additionalProperties: schema form recurses; boolean form (true/false) is left untouched.
	if (isPlainObject(out.additionalProperties)) {
		out.additionalProperties = sanitizeJsonSchema(out.additionalProperties);
	}

	// Array applicators: single schema, tuple array, or contains schema.
	if (isPlainObject(out.items)) out.items = sanitizeJsonSchema(out.items);
	else if (Array.isArray(out.items)) out.items = out.items.map(recurse);
	if (Array.isArray(out.prefixItems)) out.prefixItems = out.prefixItems.map(recurse);
	if (isPlainObject(out.contains)) out.contains = sanitizeJsonSchema(out.contains);

	// Schema combinators.
	for (const kw of ["anyOf", "oneOf", "allOf"] as const) {
		const branch = out[kw];
		if (Array.isArray(branch)) out[kw] = branch.map(recurse);
	}
	if (isPlainObject(out.not)) out.not = sanitizeJsonSchema(out.not);

	// Ensure a `type` exists when none is implied. An empty `{}` is left as-is:
	// it means "match any value" (e.g. hf.co/mcp's `hf_jobs.args` arbitrary map),
	// so coercing it would wrongly narrow non-string arguments. Object/array
	// applicator keywords (properties, patternProperties, items, ...) imply the
	// container type, so a map/array schema is never narrowed to a string.
	if (out.type === undefined && Object.keys(out).length > 0) {
		if (OBJECT_IMPLYING_KEYWORDS.some((k) => k in out)) out.type = "object";
		else if (ARRAY_IMPLYING_KEYWORDS.some((k) => k in out)) out.type = "array";
		else if (!TYPE_IMPLYING_KEYWORDS.some((k) => k in out)) out.type = "string";
	}

	return out;
}

function serverCacheKey(server: McpServerConfig): string {
	const headers = server.headers
		? Object.entries(server.headers).sort(([a], [b]) => a.localeCompare(b))
		: [];
	return JSON.stringify([server.url, headers]);
}

function evictExpired(now: number) {
	for (const [key, entry] of cache) {
		if (now - entry.fetchedAt >= entry.ttlMs) {
			cache.delete(key);
		}
	}
}

function enforceCacheCap() {
	if (cache.size <= MAX_CACHE_ENTRIES) return;
	const oldestFirst = [...cache.entries()].sort((a, b) => a[1].fetchedAt - b[1].fetchedAt);
	for (const [key] of oldestFirst.slice(0, cache.size - MAX_CACHE_ENTRIES)) {
		cache.delete(key);
	}
}

type ListedTool = {
	name?: string;
	inputSchema?: Record<string, unknown>;
	description?: string;
	annotations?: { title?: string };
};

async function listServerTools(
	server: McpServerConfig,
	opts: { signal?: AbortSignal } = {}
): Promise<ListedTool[]> {
	const url = new URL(server.url);
	const client = new Client({ name: "chat-ui-mcp", version: "0.1.0" });
	try {
		try {
			const transport = new StreamableHTTPClientTransport(url, {
				requestInit: { headers: server.headers, signal: opts.signal },
				fetch: ssrfSafeFetch,
			});
			await client.connect(transport);
		} catch {
			const transport = new SSEClientTransport(url, {
				requestInit: { headers: server.headers, signal: opts.signal },
				fetch: ssrfSafeFetch,
			});
			await client.connect(transport);
		}

		const response = await client.listTools({});
		const tools = Array.isArray(response?.tools) ? (response.tools as ListedTool[]) : [];
		try {
			logger.debug(
				{
					server: server.name,
					url: server.url,
					count: tools.length,
					toolNames: tools.map((t) => t?.name).filter(Boolean),
				},
				"[mcp] listed tools from server"
			);
		} catch {}
		return tools;
	} finally {
		try {
			await client.close?.();
		} catch {
			// ignore close errors
		}
	}
}

async function fetchServerTools(
	server: McpServerConfig,
	opts: { signal?: AbortSignal } = {}
): Promise<CachedServerTool[]> {
	const raw = await listServerTools(server, opts);
	const normalized: CachedServerTool[] = [];
	for (const tool of raw) {
		if (typeof tool.name !== "string" || tool.name.trim().length === 0) {
			continue;
		}
		normalized.push({
			name: tool.name,
			description: tool.description ?? tool.annotations?.title,
			parameters: isPlainObject(tool.inputSchema)
				? sanitizeJsonSchema(tool.inputSchema)
				: undefined,
		});
	}
	return normalized;
}

export async function getOpenAiToolsForMcp(
	servers: McpServerConfig[],
	{ ttlMs = DEFAULT_TTL_MS, signal }: { ttlMs?: number; signal?: AbortSignal } = {}
): Promise<{ tools: OpenAiTool[]; mapping: Record<string, McpToolMapping> }> {
	const now = Date.now();
	evictExpired(now);

	// Resolve each server's tools from the per-server cache; only cold servers
	// are fetched, in parallel. A failed listing contributes no tools and caches
	// nothing, so the next request retries that server.
	const listed = await Promise.all(
		servers.map(async (server): Promise<CachedServerTool[]> => {
			const key = serverCacheKey(server);
			const cached = cache.get(key);
			if (cached) {
				return cached.tools;
			}
			try {
				const tools = await fetchServerTools(server, { signal });
				cache.set(key, { fetchedAt: now, ttlMs, tools });
				return tools;
			} catch (err) {
				logger.debug(
					{ server: server.name, url: server.url, err: String(err) },
					"[mcp] failed to list tools for server"
				);
				return [];
			}
		})
	);
	enforceCacheCap();

	// Function names depend on the request's server combination (collision
	// suffixes), so definitions and mapping are rebuilt per request from the
	// cached per-server listings.
	const tools: OpenAiTool[] = [];
	const mapping: Record<string, McpToolMapping> = {};

	const seenNames = new Set<string>();

	const pushToolDefinition = (
		name: string,
		description: string | undefined,
		parameters: Record<string, unknown> | undefined
	) => {
		if (seenNames.has(name)) return;
		tools.push({
			type: "function",
			function: {
				name,
				description,
				parameters,
			},
		});
		seenNames.add(name);
	};

	for (const [index, server] of servers.entries()) {
		for (const tool of listed[index]) {
			// Emit a collision-aware function name.
			// Prefer the plain tool name; on conflict, suffix with server name.
			let plainName = sanitizeName(tool.name);
			if (plainName in mapping) {
				const suffix = sanitizeName(server.name);
				const candidate = `${plainName}_${suffix}`.slice(0, 64);
				if (!(candidate in mapping)) {
					plainName = candidate;
				} else {
					let n = 2;
					let next = `${candidate}_${n}`;
					while (n < 10 && next in mapping) {
						n += 1;
						next = `${candidate}_${n}`;
					}
					plainName = next.slice(0, 64);
				}
			}

			pushToolDefinition(plainName, tool.description, tool.parameters);
			mapping[plainName] = {
				fnName: plainName,
				server: server.name,
				tool: tool.name,
			};
		}
	}

	return { tools, mapping };
}

export function resetMcpToolsCache() {
	cache.clear();
}
