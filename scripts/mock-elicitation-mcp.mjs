/**
 * MCP server for exercising elicitation by hand.
 *
 * Served through `createMcpHandler`, the 2026-07-28 entry point, so a client negotiating
 * `auto` lands on the modern era and fulfils `input_required` natively — the path
 * hf.co/mcp uses. Legacy requests are served statelessly, which cannot carry
 * server-to-client requests; see docs/serving/legacy-clients.md for the routing pattern
 * that keeps a sessionful legacy leg alongside.
 *
 * Run:  node scripts/mock-elicitation-mcp.mjs
 * Then add http://127.0.0.1:8792/mcp as an MCP server in the UI.
 * Requires MCP_ALLOW_INSECURE_URLS=true, or chat-ui rejects the loopback URL.
 */
import { createServer } from "node:http";
import { toNodeHandler } from "@modelcontextprotocol/node";
import {
	createMcpHandler,
	McpServer,
	inputRequired,
	acceptedContent,
} from "@modelcontextprotocol/server";

const PORT = Number(process.env.MOCK_ELICITATION_MCP_PORT ?? 8792);

// Long enough to test walking away; the MCP SDK default is 60s.
const PATIENT_MS = 60 * 60_000;

const report = (tool, result) =>
	`${tool}: user chose "${result.action}"` +
	(result.content ? `\n${JSON.stringify(result.content, null, 2)}` : "");

function buildServer() {
	const server = new McpServer({ name: "mock-elicitation-mcp", version: "1.0.0" });

	server.registerTool(
		"book_meeting",
		{
			description:
				"Books a meeting. Asks the user for the details it needs before booking anything.",
		},
		async (...args) => {
			const ctx = args.at(-1);
			const given = acceptedContent(ctx?.mcpReq?.inputResponses, "details");
			if (!given) {
				console.log("[mock-elicitation-mcp] book_meeting -> input_required");
				return inputRequired({
					inputRequests: {
						details: inputRequired.elicit({
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
						}),
					},
				});
			}
			console.log("[mock-elicitation-mcp] book_meeting <- re-entered");
			return {
				content: [{ type: "text", text: `book_meeting: ${JSON.stringify(given, null, 2)}` }],
			};
		}
	);

	server.registerTool(
		"double_check",
		{ description: "Performs a destructive action, confirming twice before doing it." },
		async (...args) => {
			const ctx = args.at(-1);
			// Each round carries only its own answers, so the step lives in `requestState` —
			// the opaque string the client echoes back byte-exact. An accessor, not a field.
			const step = ctx?.mcpReq?.requestState?.() ?? "start";
			const responses = ctx?.mcpReq?.inputResponses;

			if (step === "start") {
				console.log("[mock-elicitation-mcp] double_check -> round 1");
				return inputRequired({
					requestState: "awaiting-confirm",
					inputRequests: {
						confirm: inputRequired.elicit({
							message: "This will delete 412 records. Type DELETE to continue.",
							requestedSchema: {
								type: "object",
								properties: { confirm: { type: "string", title: "Confirmation" } },
								required: ["confirm"],
							},
						}),
					},
				});
			}

			if (step === "awaiting-confirm") {
				if (acceptedContent(responses, "confirm")?.confirm !== "DELETE") {
					return { content: [{ type: "text", text: "Aborted at the first confirmation." }] };
				}
				console.log("[mock-elicitation-mcp] double_check -> round 2");
				return inputRequired({
					requestState: "awaiting-sure",
					inputRequests: {
						sure: inputRequired.elicit({
							message: "Last chance. Really delete them?",
							requestedSchema: {
								type: "object",
								properties: { sure: { type: "boolean", title: "Yes, delete them" } },
								required: ["sure"],
							},
						}),
					},
				});
			}

			const sure = acceptedContent(responses, "sure");
			return { content: [{ type: "text", text: `double_check: ${JSON.stringify(sure)}` }] };
		}
	);

	server.registerTool(
		"impatient_confirm",
		{
			description: "Asks for a confirmation but only waits five seconds for it.",
			inputSchema: {},
		},
		async () => {
			// The pre-MRTR style: the server sends the request. On a 2025-era connection this
			// exercises the client's "server stopped waiting" path; on modern it fails fast,
			// because a server cannot raise an unsolicited request there at all.
			console.log("[mock-elicitation-mcp] impatient_confirm -> server-initiated, 5s timeout");
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
		{ description: "Signs the user in to the external service before continuing." },
		async (...args) => {
			const ctx = args.at(-1);
			if (!ctx?.mcpReq?.inputResponses?.auth) {
				console.log("[mock-elicitation-mcp] sign_in -> input_required (url)");
				return inputRequired({
					inputRequests: {
						auth: inputRequired.elicitUrl({
							message: "Sign in to Example Corp, then come back here.",
							url: "https://example.com/oauth/authorize?client_id=demo",
						}),
					},
				});
			}
			return { content: [{ type: "text", text: "sign_in: returned from the link" }] };
		}
	);

	return server;
}

const httpServer = createServer(toNodeHandler(createMcpHandler(buildServer)));

httpServer.listen(PORT, "127.0.0.1", () => {
	console.log(`[mock-elicitation-mcp] listening on http://127.0.0.1:${PORT}/mcp`);
	console.log(
		"[mock-elicitation-mcp] tools: book_meeting, double_check, impatient_confirm, sign_in"
	);
});
