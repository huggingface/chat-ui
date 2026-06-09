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

interface CacheEntry {
	fetchedAt: number;
	ttlMs: number;
	tools: OpenAiTool[];
	mapping: Record<string, McpToolMapping>;
}

const DEFAULT_TTL_MS = 60_000;
const cache = new Map<string, CacheEntry>();

// Per OpenAI tool/function name guidelines most providers enforce:
//   ^[a-zA-Z0-9_-]{1,64}$
// Dots are not universally accepted (e.g., MiniMax via HF router rejects them).
// Normalize any disallowed characters (including ".") to underscore and trim to 64 chars.
function sanitizeName(name: string) {
	return name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
}

const TYPE_IMPLYING_KEYWORDS = ["enum", "const", "$ref", "anyOf", "oneOf", "allOf", "not"] as const;

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

	if (isPlainObject(out.properties)) {
		const props: Record<string, unknown> = {};
		for (const [name, sub] of Object.entries(out.properties)) {
			props[name] = isPlainObject(sub) ? sanitizeJsonSchema(sub) : sub;
		}
		out.properties = props;
	}

	if (isPlainObject(out.items)) {
		out.items = sanitizeJsonSchema(out.items);
	} else if (Array.isArray(out.items)) {
		out.items = out.items.map((s) => (isPlainObject(s) ? sanitizeJsonSchema(s) : s));
	}

	for (const kw of ["anyOf", "oneOf", "allOf"] as const) {
		const branch = out[kw];
		if (Array.isArray(branch)) {
			out[kw] = branch.map((s) => (isPlainObject(s) ? sanitizeJsonSchema(s) : s));
		}
	}
	if (isPlainObject(out.not)) out.not = sanitizeJsonSchema(out.not);
	if (isPlainObject(out.additionalProperties)) {
		// boolean form (true/false) is left untouched on purpose
		out.additionalProperties = sanitizeJsonSchema(out.additionalProperties);
	}

	// Ensure a `type` exists when none is implied. An empty `{}` is left as-is:
	// it means "match any value" (e.g. hf.co/mcp's `hf_jobs.args` arbitrary map),
	// so coercing it to a string would wrongly narrow non-string arguments.
	if (out.type === undefined && Object.keys(out).length > 0) {
		if ("properties" in out) out.type = "object";
		else if ("items" in out) out.type = "array";
		else if (!TYPE_IMPLYING_KEYWORDS.some((k) => k in out)) out.type = "string";
	}

	return out;
}

function buildCacheKey(servers: McpServerConfig[]): string {
	const normalized = servers
		.map((server) => ({
			name: server.name,
			url: server.url,
			headers: server.headers
				? Object.entries(server.headers)
						.sort(([a], [b]) => a.localeCompare(b))
						.map(([key, value]) => [key, value])
				: [],
		}))
		.sort((a, b) => {
			const byName = a.name.localeCompare(b.name);
			if (byName !== 0) return byName;
			return a.url.localeCompare(b.url);
		});

	return JSON.stringify(normalized);
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

export async function getOpenAiToolsForMcp(
	servers: McpServerConfig[],
	{ ttlMs = DEFAULT_TTL_MS, signal }: { ttlMs?: number; signal?: AbortSignal } = {}
): Promise<{ tools: OpenAiTool[]; mapping: Record<string, McpToolMapping> }> {
	const now = Date.now();
	const cacheKey = buildCacheKey(servers);
	const cached = cache.get(cacheKey);
	if (cached && now - cached.fetchedAt < cached.ttlMs) {
		return { tools: cached.tools, mapping: cached.mapping };
	}

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

	// Fetch tools in parallel; tolerate individual failures
	const tasks = servers.map((server) => listServerTools(server, { signal }));
	const results = await Promise.allSettled(tasks);

	for (let i = 0; i < results.length; i++) {
		const server = servers[i];
		const r = results[i];
		if (r.status === "fulfilled") {
			const serverTools = r.value;
			for (const tool of serverTools) {
				if (typeof tool.name !== "string" || tool.name.trim().length === 0) {
					continue;
				}

				const parameters = isPlainObject(tool.inputSchema)
					? sanitizeJsonSchema(tool.inputSchema)
					: undefined;
				const description = tool.description ?? tool.annotations?.title;
				const toolName = tool.name;

				// Emit a collision-aware function name.
				// Prefer the plain tool name; on conflict, suffix with server name.
				let plainName = sanitizeName(toolName);
				if (plainName in mapping) {
					const suffix = sanitizeName(server.name);
					const candidate = `${plainName}_${suffix}`.slice(0, 64);
					if (!(candidate in mapping)) {
						plainName = candidate;
					} else {
						let i = 2;
						let next = `${candidate}_${i}`;
						while (i < 10 && next in mapping) {
							i += 1;
							next = `${candidate}_${i}`;
						}
						plainName = next.slice(0, 64);
					}
				}

				pushToolDefinition(plainName, description, parameters);
				mapping[plainName] = {
					fnName: plainName,
					server: server.name,
					tool: toolName,
				};
			}
		} else {
			// ignore failure for this server
			continue;
		}
	}

	cache.set(cacheKey, { fetchedAt: now, ttlMs, tools, mapping });
	return { tools, mapping };
}

export function resetMcpToolsCache() {
	cache.clear();
}
