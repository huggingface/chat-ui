import { Client } from "@modelcontextprotocol/sdk/client";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse";
import type { McpServerConfig } from "./httpClient";

export type OpenAITool = {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
};

export type McpToolMapping = {
  // Fully-qualified function name exposed to OpenAI (e.g., "web.search")
  fnName: string;
  server: string;
  tool: string;
};

type CachedTools = {
  fetchedAt: number;
  ttlMs: number;
  tools: OpenAITool[];
  mapping: Record<string, McpToolMapping>;
};

let cache: CachedTools | null = null;
const DEFAULT_TTL_MS = 60_000; // 1 minute

function sanitizeName(name: string) {
  // Allow letters, digits, underscore, dot and hyphen, truncate to 64 as per OpenAI constraint
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 64);
}

async function listServerTools(server: McpServerConfig) {
  const url = new URL(server.url);
  const client = new Client({ name: "chat-ui-mcp", version: "0.1.0" });
  try {
    try {
      const transport = new StreamableHTTPClientTransport(url, { requestInit: { headers: server.headers } });
      await client.connect(transport);
    } catch {
      const transport = new SSEClientTransport(url, { requestInit: { headers: server.headers } });
      await client.connect(transport);
    }
    const res = await client.listTools({});
    return res.tools;
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
  opts?: { ttlMs?: number }
): Promise<{ tools: OpenAITool[]; mapping: Record<string, McpToolMapping> }> {
  const now = Date.now();
  if (cache && now - cache.fetchedAt < (cache.ttlMs ?? DEFAULT_TTL_MS)) {
    return { tools: cache.tools, mapping: cache.mapping };
  }

  const allTools: OpenAITool[] = [];
  const mapping: Record<string, McpToolMapping> = {};

  for (const server of servers) {
    try {
      const tools = await listServerTools(server);
      for (const t of tools as any[]) {
        const fnName = sanitizeName(`${server.name}.${t.name}`);
        const parameters = t.inputSchema ? (t.inputSchema as Record<string, unknown>) : undefined;
        const description = t.description ?? t?.annotations?.title;
        const openAiTool: OpenAITool = {
          type: "function",
          function: { name: fnName, description, parameters },
        };
        allTools.push(openAiTool);
        mapping[fnName] = { fnName, server: server.name, tool: t.name };
      }
    } catch {
      // ignore errors for a single server
    }
  }

  cache = { fetchedAt: now, ttlMs: opts?.ttlMs ?? DEFAULT_TTL_MS, tools: allTools, mapping };
  return { tools: allTools, mapping };
}

export function resetMcpToolsCache(): void {
  cache = null;
}
