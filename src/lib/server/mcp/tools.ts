import { Client } from "@modelcontextprotocol/sdk/client";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type { McpServerConfig } from "./httpClient";

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

function sanitizeName(name: string) {
	return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 64);
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

async function listServerTools(server: McpServerConfig): Promise<ListedTool[]> {
	const url = new URL(server.url);
	const client = new Client({ name: "chat-ui-mcp", version: "0.1.0" });
	try {
		try {
			const transport = new StreamableHTTPClientTransport(url, {
				requestInit: { headers: server.headers },
			});
			await client.connect(transport);
		} catch {
			const transport = new SSEClientTransport(url, {
				requestInit: { headers: server.headers },
			});
			await client.connect(transport);
		}

		const response = await client.listTools({});
		return Array.isArray(response?.tools) ? (response.tools as ListedTool[]) : [];
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
	{ ttlMs = DEFAULT_TTL_MS }: { ttlMs?: number } = {}
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

	for (const server of servers) {
		try {
			const serverTools = await listServerTools(server);
			for (const tool of serverTools) {
				if (typeof tool.name !== "string" || tool.name.trim().length === 0) {
					continue;
				}

				const parameters =
					tool.inputSchema && typeof tool.inputSchema === "object" ? tool.inputSchema : undefined;
				const description = tool.description ?? tool.annotations?.title;
				const toolName = tool.name;

				const primaryName = sanitizeName(`${server.name}.${toolName}`);
				pushToolDefinition(primaryName, description, parameters);
				mapping[primaryName] = {
					fnName: primaryName,
					server: server.name,
					tool: toolName,
				};

				const plainName = sanitizeName(toolName);
				if (!(plainName in mapping)) {
					pushToolDefinition(plainName, description, parameters);
					mapping[plainName] = {
						fnName: plainName,
						server: server.name,
						tool: toolName,
					};
				}
			}
		} catch {
			// Ignore individual server failures
			continue;
		}
	}

	cache.set(cacheKey, { fetchedAt: now, ttlMs, tools, mapping });
	return { tools, mapping };
}

export function resetMcpToolsCache() {
	cache.clear();
}
