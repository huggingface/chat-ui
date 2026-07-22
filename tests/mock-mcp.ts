/**
 * Mock MCP server over Streamable HTTP, exposing an `echo` and an `add` tool. Stateless
 * (`sessionIdGenerator: undefined`) with a fresh transport per request.
 *
 * The app cannot reach this yet: `runMcpFlow` filters selected servers through `isValidUrl`,
 * which requires https and rejects loopback, and `ssrfSafeFetch` blocks the resolved internal IP
 * at connect time. Unblocking it needs an env-gated escape hatch in those two files.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

export const MOCK_MCP_PORT = Number(process.env.MOCK_MCP_PORT ?? 8789);

/** Tool names exposed by this server, for assertions in specs. */
export const MOCK_MCP_TOOLS = ["echo", "add"] as const;

/** One tool invocation, recorded for assertions. */
export interface RecordedToolCall {
	name: string;
	args: Record<string, unknown>;
	at: number;
}

export interface MockMcp {
	/** MCP endpoint to hand to the app, e.g. `http://127.0.0.1:8789/mcp`. */
	url: string;
	origin: string;
	port: number;
	/** Tool calls seen so far. */
	calls(): RecordedToolCall[];
	reset(): void;
	close(): Promise<void>;
}

function buildServer(record: (call: RecordedToolCall) => void): McpServer {
	const server = new McpServer(
		{ name: "mock-mcp", version: "1.0.0" },
		{ capabilities: { tools: {} } }
	);

	server.registerTool(
		"echo",
		{
			description: "Echoes back the text it is given.",
			inputSchema: { text: z.string().describe("Text to echo back") },
		},
		({ text }) => {
			record({ name: "echo", args: { text }, at: Date.now() });
			return { content: [{ type: "text" as const, text }] };
		}
	);

	server.registerTool(
		"add",
		{
			description: "Adds two numbers and returns the sum.",
			inputSchema: { a: z.number(), b: z.number() },
		},
		({ a, b }) => {
			record({ name: "add", args: { a, b }, at: Date.now() });
			return { content: [{ type: "text" as const, text: String(a + b) }] };
		}
	);

	return server;
}

export async function startMockMcp(port: number = MOCK_MCP_PORT): Promise<MockMcp> {
	const recorded: RecordedToolCall[] = [];
	const record = (call: RecordedToolCall) => {
		recorded.push(call);
	};

	const httpServer: Server = createServer((req, res) => {
		void handle(req, res).catch((err) => {
			if (!res.headersSent) {
				res.writeHead(500, { "content-type": "application/json" });
				res.end(JSON.stringify({ error: String(err) }));
			} else {
				res.end();
			}
		});
	});

	async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
		const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);

		// Plain GET so Playwright's `webServer.url` readiness probe has something
		// to poll — the MCP endpoint itself needs POST plus specific Accept headers.
		if (url.pathname === "/health") {
			res.writeHead(200, { "content-type": "application/json" });
			res.end(JSON.stringify({ ok: true, tools: MOCK_MCP_TOOLS }));
			return;
		}

		if (url.pathname === "/__control/calls" && req.method === "GET") {
			res.writeHead(200, { "content-type": "application/json" });
			res.end(JSON.stringify(recorded));
			return;
		}

		if (url.pathname === "/__control/reset" && req.method === "POST") {
			recorded.length = 0;
			res.writeHead(200, { "content-type": "application/json" });
			res.end(JSON.stringify({ ok: true }));
			return;
		}

		if (url.pathname === "/mcp") {
			// Stateless: a fresh server + transport per request, torn down after.
			const server = buildServer(record);
			const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
			res.on("close", () => {
				void transport.close();
				void server.close();
			});
			await server.connect(transport);
			await transport.handleRequest(req, res);
			return;
		}

		res.writeHead(404, { "content-type": "application/json" });
		res.end(JSON.stringify({ error: "not found", path: url.pathname }));
	}

	await new Promise<void>((resolve) => httpServer.listen(port, "127.0.0.1", resolve));
	const actualPort = (httpServer.address() as AddressInfo).port;
	const origin = `http://127.0.0.1:${actualPort}`;

	return {
		url: `${origin}/mcp`,
		origin,
		port: actualPort,
		calls: () => [...recorded],
		reset: () => {
			recorded.length = 0;
		},
		close: () =>
			new Promise<void>((resolve, reject) =>
				httpServer.close((err) => (err ? reject(err) : resolve()))
			),
	};
}

// ── CLI mode: `node --experimental-strip-types e2e/mock-mcp.ts` ──────────────
const invokedDirectly =
	process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
	startMockMcp().then((mock) => {
		console.log(`[mock-mcp] listening on ${mock.url}`);
	});
}
