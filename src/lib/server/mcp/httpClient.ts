import { Client } from "@modelcontextprotocol/sdk/client";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse";

export type McpServerConfig = {
  name: string;
  url: string; // e.g. http://127.0.0.1:3000/mcp
  headers?: Record<string, string>;
};

// Reasonable default timeout for a single tool call
const DEFAULT_TIMEOUT_MS = 30_000;

function parseUrl(input: string): URL {
  try {
    return new URL(input);
  } catch (e) {
    throw new Error(`Invalid MCP server URL: ${input}`);
  }
}

export async function callMcpTool(
  server: McpServerConfig,
  tool: string,
  args: unknown = {},
  opts?: { timeoutMs?: number }
): Promise<string> {
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const url = parseUrl(server.url);

  const client = new Client({ name: "chat-ui-mcp", version: "0.1.0" });

  // Prefer Streamable HTTP; fall back to SSE if connection/init fails.
  async function connectStreamable() {
    const transport = new StreamableHTTPClientTransport(url, {
      requestInit: { headers: server.headers },
    });
    await client.connect(transport);
  }

  async function connectSse() {
    const transport = new SSEClientTransport(url, {
      requestInit: { headers: server.headers },
    });
    await client.connect(transport);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    let usedSse = false;
    try {
      await connectStreamable();
    } catch {
      await connectSse();
      usedSse = true;
    }

    // Execute the tool call with a best-effort timeout (client doesn't take signal directly)
    const doCall = async () => client.callTool({ name: tool, arguments: args });
    const race = <T>(p: Promise<T>) =>
      Promise.race([
        p,
        new Promise<never>((_, reject) => {
          controller.signal.addEventListener("abort", () => reject(new Error("MCP tool call timed out")));
        }),
      ]);

    let result: any;
    try {
      result = await race(doCall());
    } catch (e) {
      // If streamable HTTP path failed, retry once with SSE
      if (!usedSse) {
        try { await client.close?.(); } catch {}
        await connectSse();
        usedSse = true;
        result = await race(doCall());
      } else {
        throw e;
      }
    }

    // Collapse MCP content parts to a single string when possible
    const parts = result?.content ?? [];
    const textParts = Array.isArray(parts)
      ? parts
          .filter((p: any) => p?.type === "text" && typeof p.text === "string")
          .map((p: any) => p.text)
      : [];
    if (textParts.length) return textParts.join("\n");

    // Fallback: return JSON string
    return JSON.stringify(result);
  } finally {
    clearTimeout(timer);
    try {
      await client.close?.();
    } catch {
      // ignore
    }
  }
}

