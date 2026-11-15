/**
 * Throwaway MCP server for manual scenario A2 — delete when done.
 *
 * Z-Image-Turbo (and Gradio's MCP bridge generally) serialises file outputs as a
 * TEXT block containing a URL, so its tool results always have text and never
 * reproduce the case under test. These tools return results with NO text block
 * at all, which is what makes `callMcpTool` produce `text: ""` (it joins only
 * text blocks) and replay emit `{role: "tool", content: ""}`.
 *
 * Three tools, three shapes:
 *   generate_cheese_image  image block only            — the realistic case
 *   empty_result           zero content blocks         — the degenerate case
 *   image_with_text        image + text (the control)  — must NOT be empty
 *
 * Run:  node scripts/mock-image-mcp.mjs
 * Then add http://127.0.0.1:8791/mcp as an MCP server in the UI.
 * Requires MCP_ALLOW_INSECURE_URLS=true, or chat-ui rejects the loopback URL.
 */
import { createServer } from "node:http";
import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";
import { McpServer } from "@modelcontextprotocol/server";

const PORT = Number(process.env.MOCK_IMAGE_MCP_PORT ?? 8791);

/** Smallest valid PNG (1x1, transparent) — the payload is irrelevant, its absence from `text` is the point. */
const PNG_1X1 =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

function buildServer() {
	const server = new McpServer(
		{ name: "mock-image-mcp", version: "1.0.0" },
		{ capabilities: { tools: {} } }
	);

	server.registerTool(
		"generate_cheese_image",
		{
			description:
				"Generates a picture of cheese. Returns the image itself, with no accompanying text.",
		},
		() => {
			console.log("[mock-image-mcp] generate_cheese_image -> image block only");
			return { content: [{ type: "image", data: PNG_1X1, mimeType: "image/png" }] };
		}
	);

	server.registerTool(
		"empty_result",
		{
			description: "Performs an action that produces no output at all.",
		},
		() => {
			console.log("[mock-image-mcp] empty_result -> zero content blocks");
			return { content: [] };
		}
	);

	server.registerTool(
		"image_with_text",
		{
			description: "Generates a picture of cheese and describes it in text.",
		},
		() => {
			console.log("[mock-image-mcp] image_with_text -> text + image (control)");
			return {
				content: [
					{ type: "text", text: "A wedge of aged gouda on a slate board. station_id=Q7M4-XP29" },
					{ type: "image", data: PNG_1X1, mimeType: "image/png" },
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
			const transport = new NodeStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
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
		console.error("[mock-image-mcp]", err);
		if (!res.headersSent) {
			res.writeHead(500, { "content-type": "application/json" });
			res.end(JSON.stringify({ error: String(err) }));
		} else {
			res.end();
		}
	});
});

httpServer.listen(PORT, "127.0.0.1", () => {
	console.log(`[mock-image-mcp] listening on http://127.0.0.1:${PORT}/mcp`);
	console.log("[mock-image-mcp] tools: generate_cheese_image, empty_result, image_with_text");
});
