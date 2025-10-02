import { Client } from "@modelcontextprotocol/sdk/client";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type { McpServerConfig } from "./httpClient";

export interface OpenAiTool {
	type: "function";
	function: {
		name: string;
		description?: string;
		parameters?: Record<string, unknown>;
	};
}

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
let cache: CacheEntry | null = null;

function sanitizeName(name: string) {
	return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 64);
}

async function listServerTools(server: McpServerConfig) {
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
		return Array.isArray(response?.tools) ? response.tools : [];
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
	if (cache && now - cache.fetchedAt < cache.ttlMs) {
		return { tools: cache.tools, mapping: cache.mapping };
	}

	const tools: OpenAiTool[] = [];
	const mapping: Record<string, McpToolMapping> = {};

  const seenNames = new Set<string>();

  const pushToolDefinition = (
    name: string,
    description: string | undefined,
    parameters: Record<string, unknown> | undefined,
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
      for (const tool of serverTools as any[]) {
        const parameters =
          tool.inputSchema && typeof tool.inputSchema === "object" ? tool.inputSchema : undefined;
        const description = tool.description ?? tool?.annotations?.title;

        const primaryName = sanitizeName(`${server.name}.${tool.name}`);
        pushToolDefinition(primaryName, description, parameters);
        mapping[primaryName] = {
          fnName: primaryName,
          server: server.name,
          tool: tool.name,
        };

        const plainName = sanitizeName(tool.name);
        if (!(plainName in mapping)) {
          pushToolDefinition(plainName, description, parameters);
          mapping[plainName] = {
            fnName: plainName,
            server: server.name,
            tool: tool.name,
          };
        }
      }
    } catch {
      // Ignore individual server failures
      continue;
    }
  }

  cache = { fetchedAt: now, ttlMs, tools, mapping };
  return { tools, mapping };
}

export function resetMcpToolsCache() {
	cache = null;
}
