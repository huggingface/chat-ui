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
								properties: {
									confirm: { type: "string", title: 'Type "DELETE" to reach round two' },
								},
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

	server.registerTool(
		"edge_defaults",
		{
			description:
				"Schedules a reminder. Defaults arrive as RFC 3339 and two switches are optional.",
		},
		async (...args) => {
			const ctx = args.at(-1);
			const given = acceptedContent(ctx?.mcpReq?.inputResponses, "when");
			if (!given) {
				console.log("[mock-elicitation-mcp] edge_defaults -> input_required");
				return inputRequired({
					inputRequests: {
						when: inputRequired.elicit({
							message: "When should this run, and how loudly?",
							requestedSchema: {
								type: "object",
								properties: {
									// RFC 3339 is what the schema asks servers to send, but a date input
									// only accepts YYYY-MM-DD, so an unnarrowed default renders blank.
									day: {
										type: "string",
										title: "Day",
										format: "date",
										default: "2026-09-01T09:30:00Z",
									},
									starts_at: {
										type: "string",
										title: "Starts at",
										format: "date-time",
										default: "2026-09-01T09:30:00Z",
									},
									// No default and not required: leaving it alone is not an answer of
									// `false`, so it should be absent from what comes back.
									notify: { type: "boolean", title: "Send a notification" },
									// Has a default, so leaving it alone should still send `true`.
									archive: { type: "boolean", title: "Archive when done", default: true },
								},
								required: ["day"],
							},
						}),
					},
				});
			}
			// Printed as keys rather than values, so an omitted switch is distinguishable
			// from one answered `false`.
			const optional = ["notify", "archive"];
			const sent = optional.filter((k) => k in given);
			const omitted = optional.filter((k) => !(k in given));
			console.log("[mock-elicitation-mcp] edge_defaults <-", JSON.stringify(given));
			return {
				content: [
					{
						type: "text",
						text:
							`edge_defaults received:\n${JSON.stringify(given, null, 2)}\n\n` +
							`switches sent: [${sent.join(", ")}]\n` +
							`switches omitted: [${omitted.join(", ")}]`,
					},
				],
			};
		}
	);

	server.registerTool(
		"pick_toppings",
		{ description: "Builds a pizza. Allows between one and two toppings, no more." },
		async (...args) => {
			const ctx = args.at(-1);
			const given = acceptedContent(ctx?.mcpReq?.inputResponses, "toppings");
			if (!given) {
				console.log("[mock-elicitation-mcp] pick_toppings -> input_required");
				return inputRequired({
					inputRequests: {
						toppings: inputRequired.elicit({
							message: "Pick one or two toppings.",
							requestedSchema: {
								type: "object",
								properties: {
									toppings: {
										type: "array",
										title: "Toppings",
										minItems: 1,
										maxItems: 2,
										items: {
											anyOf: [
												{ const: "anchovy", title: "Anchovy" },
												{ const: "caper", title: "Caper" },
												{ const: "olive", title: "Olive" },
												{ const: "chilli", title: "Chilli" },
												{ const: "basil", title: "Basil" },
											],
										},
									},
								},
								required: ["toppings"],
							},
						}),
					},
				});
			}
			return {
				content: [{ type: "text", text: `pick_toppings: ${JSON.stringify(given)}` }],
			};
		}
	);

	server.registerTool(
		"hostile_schema",
		{ description: "Asks for a field named __proto__, which no answer object can carry." },
		async (...args) => {
			const ctx = args.at(-1);
			if (!ctx?.mcpReq?.inputResponses?.evil) {
				console.log("[mock-elicitation-mcp] hostile_schema -> input_required (should be refused)");
				return inputRequired({
					inputRequests: {
						evil: inputRequired.elicit({
							message: "This prompt should never reach you.",
							requestedSchema: {
								type: "object",
								properties: {
									name: { type: "string", title: "Your name" },
									// Computed, or the literal key would set this object's prototype
									// here instead of travelling as a property name.
									["__proto__"]: { type: "string", title: "Harmless looking" },
								},
							},
						}),
					},
				});
			}
			return { content: [{ type: "text", text: "hostile_schema: somehow answered" }] };
		}
	);

	server.registerTool(
		"sign_in_punycode",
		{ description: "Signs in via a link whose hostname is punycode." },
		async (...args) => {
			const ctx = args.at(-1);
			if (!ctx?.mcpReq?.inputResponses?.auth) {
				console.log("[mock-elicitation-mcp] sign_in_punycode -> input_required (url)");
				return inputRequired({
					inputRequests: {
						auth: inputRequired.elicitUrl({
							message: "Sign in to continue.",
							// Renders as "аррӏе.com" in a browser: Cyrillic homoglyphs, not apple.com.
							url: "https://xn--80ak6aa92e.com/login",
						}),
					},
				});
			}
			return { content: [{ type: "text", text: "sign_in_punycode: returned from the link" }] };
		}
	);

	server.registerTool(
		"sign_in_internal",
		{ description: "Signs in via a plaintext link pointing inside a private network." },
		async (...args) => {
			const ctx = args.at(-1);
			if (!ctx?.mcpReq?.inputResponses?.auth) {
				console.log("[mock-elicitation-mcp] sign_in_internal -> input_required (url)");
				return inputRequired({
					inputRequests: {
						auth: inputRequired.elicitUrl({
							message: "Authorise on the internal portal.",
							url: "http://192.168.1.50:8080/auth?next=/admin",
						}),
					},
				});
			}
			return { content: [{ type: "text", text: "sign_in_internal: returned from the link" }] };
		}
	);

	return server;
}

const httpServer = createServer(toNodeHandler(createMcpHandler(buildServer)));

httpServer.listen(PORT, "127.0.0.1", () => {
	console.log(`[mock-elicitation-mcp] listening on http://127.0.0.1:${PORT}/mcp`);
	console.log("[mock-elicitation-mcp] tools:");
	console.log("  book_meeting, double_check, impatient_confirm, sign_in");
	console.log("  edge_defaults, pick_toppings, hostile_schema");
	console.log("  sign_in_punycode, sign_in_internal");
});
