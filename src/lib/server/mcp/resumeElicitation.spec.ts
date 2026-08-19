import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { ObjectId } from "mongodb";
import {
	createMcpHandler,
	McpServer,
	inputRequired,
	acceptedContent,
} from "@modelcontextprotocol/server";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { collections, ready } from "$lib/server/database";
import { resumeParkedToolCall } from "./resumeElicitation";
import {
	isMessageElicitationRequestUpdate,
	isMessageElicitationResolvedUpdate,
} from "$lib/utils/messageUpdates";

await ready;

/** A 2026-era server that asks twice, carrying its step in `requestState`. */
const handler = createMcpHandler(() => {
	const server = new McpServer({ name: "twice", version: "1.0.0" });
	server.registerTool("confirm_twice", { description: "Confirms twice." }, async (...args) => {
		const ctx = args.at(-1) as {
			mcpReq?: {
				inputResponses?: Record<string, unknown>;
				requestState?: () => string | undefined;
			};
		};
		const step = ctx?.mcpReq?.requestState?.() ?? "start";
		if (step === "start") {
			return inputRequired({
				requestState: "asked-once",
				inputRequests: {
					first: inputRequired.elicit({
						message: "Really?",
						requestedSchema: { type: "object", properties: { ok: { type: "string" } } },
					}),
				},
			});
		}
		if (step === "asked-once") {
			return inputRequired({
				requestState: "asked-twice",
				inputRequests: {
					second: inputRequired.elicit({
						message: "Are you sure?",
						requestedSchema: { type: "object", properties: { sure: { type: "string" } } },
					}),
				},
			});
		}
		const got = acceptedContent(ctx?.mcpReq?.inputResponses, "second");
		return { content: [{ type: "text" as const, text: `done ${JSON.stringify(got)}` }] };
	});
	return server;
});

let server: Server;
let servers: { name: string; url: string }[];

beforeAll(async () => {
	server = createServer(toNodeHandler(handler));
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const { port } = server.address() as AddressInfo;
	servers = [{ name: "Twice", url: `http://127.0.0.1:${port}/mcp` }];
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

async function park(
	conversationId: ObjectId,
	inputKey: string,
	requestState: string | undefined,
	content: Record<string, string>
) {
	const elicitationId = crypto.randomUUID();
	await collections.mcpElicitations.insertOne({
		_id: new ObjectId(),
		elicitationId,
		conversationId,
		status: "resolved",
		action: "accept",
		content,
		request: { elicitationId, server: "Twice", mode: "form", message: "?", fields: [] },
		pending: {
			server: "Twice",
			tool: "confirm_twice",
			args: {},
			inputKey,
			messageId: "m1",
			toolCallId: "c1",
			toolUuid: "u1",
			...(requestState !== undefined ? { requestState } : {}),
		},
		createdAt: new Date(),
		updatedAt: new Date(),
	});
	return elicitationId;
}

describe("resuming a parked tool call", () => {
	it("parks again when the tool asks a second time", async () => {
		// Returning here instead would hand the model a round that never produced a result.
		const conversationId = new ObjectId();
		const first = await park(conversationId, "first", "asked-once", { ok: "yes" });

		const round1 = await resumeParkedToolCall({
			conversationId,
			elicitationId: first,
			extraServers: servers,
		});

		expect(round1.parkedAgain).toBe(true);
		// The answered prompt is settled first, so a reloaded transcript stops showing it
		// as an open form and can render what was submitted.
		const settled = round1.updates.find(isMessageElicitationResolvedUpdate);
		expect(settled).toMatchObject({ action: "accept", content: { ok: "yes" } });
		const prompt = round1.updates.find(isMessageElicitationRequestUpdate);
		expect(prompt?.request.message).toBe("Are you sure?");
		// A durable prompt carries no deadline, so the UI shows no countdown.
		expect(prompt?.expiresAt).toBeUndefined();

		const stored = await collections.mcpElicitations.findOne({
			elicitationId: prompt?.request.elicitationId,
		});
		expect(stored?.pending?.requestState).toBe("asked-twice");
		expect(stored?.pending?.inputKey).toBe("second");
	});

	it("returns the tool result once the last question is answered", async () => {
		const conversationId = new ObjectId();
		const last = await park(conversationId, "second", "asked-twice", { sure: "yes" });

		const done = await resumeParkedToolCall({
			conversationId,
			elicitationId: last,
			extraServers: servers,
		});

		expect(done.parkedAgain).toBeUndefined();
		expect(done.updates.find(isMessageElicitationResolvedUpdate)).toMatchObject({
			action: "accept",
		});
		const result = done.updates.find(
			(u) => u.type === "tool" && u.subtype === "result"
		) as unknown as { result?: { outputs?: { text?: string }[] } };
		expect(result?.result?.outputs?.[0]?.text).toContain("done");
	});

	it("reports a prompt it cannot resume rather than pretending", async () => {
		const outcome = await resumeParkedToolCall({
			conversationId: new ObjectId(),
			elicitationId: crypto.randomUUID(),
			extraServers: servers,
		});

		expect(outcome).toMatchObject({ resumed: false });
		expect(outcome.updates).toHaveLength(0);
	});
});
