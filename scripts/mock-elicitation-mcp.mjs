/**
 * MCP server for exercising elicitation by hand.
 *
 * Stateful, unlike mock-image-mcp.mjs: the client answers `elicitation/create` on a new
 * POST, which a per-request server instance would not recognise.
 *
 * Run:  node scripts/mock-elicitation-mcp.mjs
 * Then add http://127.0.0.1:8792/mcp as an MCP server in the UI.
 * Requires MCP_ALLOW_INSECURE_URLS=true, or chat-ui rejects the loopback URL.
 */
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";

const PORT = Number(process.env.MOCK_ELICITATION_MCP_PORT ?? 8792);

// Long enough to test walking away; the MCP SDK default is 60s.
const PATIENT_MS = 60 * 60_000;

const report = (tool, result) =>
	`${tool}: user chose "${result.action}"` +
	(result.content ? `\n${JSON.stringify(result.content, null, 2)}` : "");

function buildServer() {
	const server = new McpServer(
		{ name: "mock-elicitation-mcp", version: "1.0.0" },
		{ capabilities: { tools: {} } }
	);

	server.registerTool(
		"book_meeting",
		{
			description:
				"Books a meeting. Asks the user for the details it needs before booking anything.",
			inputSchema: {},
		},
		async () => {
			console.log("[mock-elicitation-mcp] book_meeting -> asking for details");
			const result = await server.server.elicitInput(
				{
					message: "I need a few details before I can book this meeting.",
					requestedSchema: {
						type: "object",
						properties: {
							title: { type: "string", title: "Meeting title", minLength: 3, maxLength: 60 },
							email: { type: "string", title: "Your email", format: "email" },
							day: { type: "string", title: "Date", format: "date" },
							attendees: { type: "integer", title: "Attendees", minimum: 1, maximum: 50 },
							room: {
								type: "string",
								title: "Room",
								oneOf: [
									{ const: "small", title: "Huddle room (4)" },
									{ const: "large", title: "Boardroom (20)" },
								],
							},
							extras: {
								type: "array",
								title: "Extras",
								maxItems: 2,
								items: {
									anyOf: [
										{ const: "coffee", title: "Coffee" },
										{ const: "projector", title: "Projector" },
										{ const: "notes", title: "Note taker" },
									],
								},
							},
							recurring: { type: "boolean", title: "Repeat weekly", default: false },
						},
						required: ["title", "day"],
					},
				},
				{ timeout: PATIENT_MS }
			);
			console.log("[mock-elicitation-mcp] book_meeting <-", result.action);
			return { content: [{ type: "text", text: report("book_meeting", result) }] };
		}
	);

	server.registerTool(
		"double_check",
		{
			description: "Performs a destructive action, confirming twice before doing it.",
			inputSchema: {},
		},
		async () => {
			console.log("[mock-elicitation-mcp] double_check -> prompt 1");
			const first = await server.server.elicitInput(
				{
					message: "This will delete 412 records. Type DELETE to continue.",
					requestedSchema: {
						type: "object",
						properties: { confirm: { type: "string", title: "Confirmation" } },
						required: ["confirm"],
					},
				},
				{ timeout: PATIENT_MS }
			);
			if (first.action !== "accept" || first.content?.confirm !== "DELETE") {
				return { content: [{ type: "text", text: "Aborted at the first confirmation." }] };
			}

			console.log("[mock-elicitation-mcp] double_check -> prompt 2");
			const second = await server.server.elicitInput(
				{
					message: "Last chance. Really delete them?",
					requestedSchema: {
						type: "object",
						properties: { sure: { type: "boolean", title: "Yes, delete them" } },
						required: ["sure"],
					},
				},
				{ timeout: PATIENT_MS }
			);
			return { content: [{ type: "text", text: report("double_check", second) }] };
		}
	);

	server.registerTool(
		"impatient_confirm",
		{
			description: "Asks for a confirmation but only waits five seconds for it.",
			inputSchema: {},
		},
		async () => {
			console.log("[mock-elicitation-mcp] impatient_confirm -> asking, 5s timeout");
			try {
				const result = await server.server.elicitInput(
					{
						message: "Answer within five seconds or I will give up.",
						requestedSchema: {
							type: "object",
							properties: { ok: { type: "boolean", title: "Go ahead" } },
						},
					},
					{ timeout: 5_000 }
				);
				return { content: [{ type: "text", text: report("impatient_confirm", result) }] };
			} catch (err) {
				console.log("[mock-elicitation-mcp] impatient_confirm gave up:", String(err));
				return {
					content: [{ type: "text", text: "Gave up waiting for confirmation." }],
					isError: true,
				};
			}
		}
	);

	server.registerTool(
		"sign_in",
		{
			description: "Signs the user in to the external service before continuing.",
			inputSchema: {},
		},
		async () => {
			console.log("[mock-elicitation-mcp] sign_in -> URL mode");
			const result = await server.server.elicitInput(
				{
					mode: "url",
					message: "Sign in to Example Corp, then come back here.",
					elicitationId: randomUUID(),
					url: "https://example.com/oauth/authorize?client_id=demo",
				},
				{ timeout: PATIENT_MS }
			);
			return { content: [{ type: "text", text: report("sign_in", result) }] };
		}
	);

	return server;
}

/** sessionId -> transport, so an elicitation answer reaches the instance that asked. */
const sessions = new Map();

async function readBody(req) {
	const chunks = [];
	for await (const chunk of req) chunks.push(chunk);
	if (chunks.length === 0) return undefined;
	return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const httpServer = createServer((req, res) => {
	void (async () => {
		const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);

		if (url.pathname === "/health") {
			res.writeHead(200, { "content-type": "application/json" });
			res.end(JSON.stringify({ ok: true, sessions: sessions.size }));
			return;
		}

		if (url.pathname !== "/mcp") {
			res.writeHead(404, { "content-type": "application/json" });
			res.end(JSON.stringify({ error: "not found", path: url.pathname }));
			return;
		}

		const sessionId = req.headers["mcp-session-id"];
		const existing = typeof sessionId === "string" ? sessions.get(sessionId) : undefined;

		if (existing) {
			await existing.handleRequest(
				req,
				res,
				req.method === "POST" ? await readBody(req) : undefined
			);
			return;
		}

		const body = req.method === "POST" ? await readBody(req) : undefined;
		if (!isInitializeRequest(body)) {
			res.writeHead(400, { "content-type": "application/json" });
			res.end(JSON.stringify({ error: "no session; send initialize first" }));
			return;
		}

		const transport = new StreamableHTTPServerTransport({
			sessionIdGenerator: () => randomUUID(),
			onsessioninitialized: (id) => {
				console.log(`[mock-elicitation-mcp] session ${id} opened`);
				sessions.set(id, transport);
			},
		});
		transport.onclose = () => {
			if (transport.sessionId) {
				console.log(`[mock-elicitation-mcp] session ${transport.sessionId} closed`);
				sessions.delete(transport.sessionId);
			}
		};
		await buildServer().connect(transport);
		await transport.handleRequest(req, res, body);
	})().catch((err) => {
		console.error("[mock-elicitation-mcp]", err);
		if (!res.headersSent) {
			res.writeHead(500, { "content-type": "application/json" });
			res.end(JSON.stringify({ error: String(err) }));
		} else {
			res.end();
		}
	});
});

httpServer.listen(PORT, "127.0.0.1", () => {
	console.log(`[mock-elicitation-mcp] listening on http://127.0.0.1:${PORT}/mcp`);
	console.log(
		"[mock-elicitation-mcp] tools: book_meeting, double_check, impatient_confirm, sign_in"
	);
});
