/**
 * Throwaway MCP server for exercising resources support by hand — delete when done.
 *
 * Exposes one tool (so the server looks realistic) and four resources chosen to hit
 * every branch of the read path:
 *
 *   file:///briefing.md   text, with an unguessable fact  — proves the model READ it
 *   note:///{id}          URI template                    — proves template routing
 *   image:///logo.png     binary blob                     — must be described, not inlined
 *   file:///huge.log      44k chars                       — must truncate at 32k
 *
 * The fact in briefing.md is the point: no model can produce "PELICAN-7734" from
 * training data, so if it turns up in the answer, the resource was genuinely read.
 *
 * Run:  node scripts/mock-resources-mcp.mjs
 * Then add http://127.0.0.1:8792/mcp as an MCP server in the UI.
 * Requires MCP_ALLOW_INSECURE_URLS=true, or chat-ui rejects the loopback URL.
 */
import { createServer } from "node:http";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

const PORT = Number(process.env.MOCK_RESOURCES_MCP_PORT ?? 8792);

/** Smallest valid PNG (1x1, transparent). */
const PNG_1X1 =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

const BRIEFING = `# Q3 Internal Briefing

The Northwind migration completed on 14 March.
Rollback codeword: PELICAN-7734.
Owner: the Platform team. Budget code: NW-0042.
`;

function buildServer() {
	const server = new McpServer(
		{ name: "mock-resources-mcp", version: "1.0.0" },
		{ capabilities: { tools: {}, resources: {} } }
	);

	// A tool, so this is not a resources-only server and the tool array stays mixed.
	server.registerTool(
		"ping",
		{ description: "Returns pong.", inputSchema: {} },
		() => ({ content: [{ type: "text", text: "pong" }] })
	);

	server.registerResource(
		"briefing",
		"file:///briefing.md",
		{
			title: "Q3 internal briefing",
			description: "Internal briefing note containing the rollback codeword.",
			mimeType: "text/markdown",
		},
		(uri) => {
			console.log("[mock-resources-mcp] read", uri.href);
			return { contents: [{ uri: uri.href, mimeType: "text/markdown", text: BRIEFING }] };
		}
	);

	server.registerResource(
		"note",
		new ResourceTemplate("note:///{id}", { list: undefined }),
		{
			title: "Scratch note",
			description: "An arbitrary note, addressed by id. Try note:///alpha.",
			mimeType: "text/plain",
		},
		(uri, { id }) => {
			console.log("[mock-resources-mcp] read", uri.href);
			return {
				contents: [
					{
						uri: uri.href,
						mimeType: "text/plain",
						text: `Note "${id}": the duty engineer this week is Sam Okafor.`,
					},
				],
			};
		}
	);

	server.registerResource(
		"logo",
		"image:///logo.png",
		{ title: "Logo", description: "A tiny PNG.", mimeType: "image/png" },
		(uri) => {
			console.log("[mock-resources-mcp] read", uri.href, "(binary)");
			return { contents: [{ uri: uri.href, mimeType: "image/png", blob: PNG_1X1 }] };
		}
	);

	server.registerResource(
		"huge",
		"file:///huge.log",
		{ title: "Huge log", description: "44k characters, to exercise truncation.", mimeType: "text/plain" },
		(uri) => {
			console.log("[mock-resources-mcp] read", uri.href, "(oversized)");
			// The tail marker must NOT survive truncation — that is how you tell it worked.
			return {
				contents: [
					{
						uri: uri.href,
						mimeType: "text/plain",
						text: `${"log line filler. ".repeat(2_750)}\nTAIL-MARKER-SHOULD-BE-CUT`,
					},
				],
			};
		}
	);

	return server;
}

const httpServer = createServer((req, res) => {
	void (async () => {
		const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);

		if (url.pathname === "/health") {
			res.writeHead(200, { "content-type": "application/json" });
			res.end(JSON.stringify({ ok: true }));
			return;
		}

		if (url.pathname === "/mcp") {
			// Stateless: a fresh server + transport per request, torn down after.
			const server = buildServer();
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
	})().catch((err) => {
		console.error("[mock-resources-mcp]", err);
		if (!res.headersSent) {
			res.writeHead(500, { "content-type": "application/json" });
			res.end(JSON.stringify({ error: String(err) }));
		} else {
			res.end();
		}
	});
});

httpServer.listen(PORT, "127.0.0.1", () => {
	console.log(`[mock-resources-mcp] listening on http://127.0.0.1:${PORT}/mcp`);
	console.log("[mock-resources-mcp] tool: ping");
	console.log(
		"[mock-resources-mcp] resources: file:///briefing.md, image:///logo.png, file:///huge.log, note:///{id}"
	);
});
