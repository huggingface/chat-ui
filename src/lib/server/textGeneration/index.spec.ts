import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import {
	MessageToolUpdateType,
	MessageUpdateStatus,
	MessageUpdateType,
	type MessageUpdate,
} from "$lib/types/MessageUpdate";
import type { McpFlowResult } from "./mcp/runMcpFlow";
import type { TextGenerationContext } from "./types";
import { AttachmentOverflowError } from "./utils/attachmentBudget";

const mocks = vi.hoisted(() => ({
	runMcpFlow: vi.fn(),
	generate: vi.fn(),
	createActivityLabeler: vi.fn(),
}));

vi.mock("./mcp/runMcpFlow", () => ({ runMcpFlow: mocks.runMcpFlow }));
vi.mock("./generate", () => ({ generate: mocks.generate }));
vi.mock("./activityLabels", () => ({ createActivityLabeler: mocks.createActivityLabeler }));
// eslint-disable-next-line require-yield
async function* noUpdates() {
	return undefined;
}

vi.mock("./title", () => ({ generateTitleForConversation: noUpdates }));
vi.mock("../endpoints/preprocessMessages", () => ({
	preprocessMessages: async (messages: unknown) => messages,
}));

const { textGeneration } = await import("./index");

const STREAM_UPDATE: MessageUpdate = { type: MessageUpdateType.Stream, token: "hello" };
const TOOL_UPDATE: MessageUpdate = {
	type: MessageUpdateType.Tool,
	subtype: MessageToolUpdateType.Call,
	uuid: "tool-1",
	call: { name: "hf_fs", parameters: {} },
};

/** An MCP flow that yields `updates`, then either returns `result` or throws `error`. */
function mcpFlow({
	updates = [] as MessageUpdate[],
	result = "completed" as McpFlowResult,
	error,
}: {
	updates?: MessageUpdate[];
	result?: McpFlowResult;
	error?: Error;
}) {
	return async function* () {
		for (const update of updates) yield update;
		if (error) throw error;
		return result;
	};
}

function makeContext(): TextGenerationContext {
	return {
		model: { id: "test/model", name: "test/model" },
		conv: { _id: new ObjectId(), preprompt: undefined },
		messages: [],
		abortController: new AbortController(),
	} as unknown as TextGenerationContext;
}

async function collect(ctx: TextGenerationContext) {
	const updates: MessageUpdate[] = [];
	for await (const update of textGeneration(ctx)) {
		// Keepalive ticks carry no content.
		if (update.type === MessageUpdateType.Status && update.status === MessageUpdateStatus.KeepAlive)
			continue;
		updates.push(update);
	}
	return updates;
}

beforeEach(() => {
	mocks.runMcpFlow.mockReset();
	mocks.createActivityLabeler.mockReset();
	mocks.generate.mockReset();
	mocks.generate.mockImplementation(noUpdates);
});

describe("textGeneration MCP fallback", () => {
	it("falls back to plain generation when MCP never ran", async () => {
		mocks.runMcpFlow.mockImplementation(mcpFlow({ result: "not_applicable" }));

		await collect(makeContext());

		expect(mocks.generate).toHaveBeenCalledTimes(1);
	});

	it("does not fall back once MCP has answered", async () => {
		mocks.runMcpFlow.mockImplementation(mcpFlow({ updates: [STREAM_UPDATE], result: "completed" }));

		await collect(makeContext());

		expect(mocks.generate).not.toHaveBeenCalled();
	});

	// Regression: exhausting the tool rounds used to re-run the turn with no tools.
	it("does not fall back when MCP exhausted its tool rounds", async () => {
		mocks.runMcpFlow.mockImplementation(mcpFlow({ updates: [TOOL_UPDATE], result: "exhausted" }));

		await collect(makeContext());

		expect(mocks.generate).not.toHaveBeenCalled();
	});

	// runMcpFlow catches its own errors, so a post-output failure can reach the caller as
	// "not_applicable" rather than a throw. Falling back on that is the same discard.
	it("does not fall back on not_applicable once output has been produced", async () => {
		mocks.runMcpFlow.mockImplementation(
			mcpFlow({ updates: [TOOL_UPDATE], result: "not_applicable" })
		);

		await collect(makeContext());

		expect(mocks.generate).not.toHaveBeenCalled();
	});

	// Regression: the same discard, reached via the error path.
	it("surfaces a failure that happens after MCP produced output", async () => {
		mocks.runMcpFlow.mockImplementation(
			mcpFlow({ updates: [TOOL_UPDATE], error: new Error("upstream exploded") })
		);

		await expect(collect(makeContext())).rejects.toThrow("upstream exploded");
		expect(mocks.generate).not.toHaveBeenCalled();
	});

	it("does not fall back after attachments were refused as too large, even cut down", async () => {
		const refused = new AttachmentOverflowError(
			{
				newest: 0,
				texts: [{ index: 0, name: "data.csv", total: 8_000_000, shown: 5_000 }],
				images: [],
			},
			Object.assign(new Error("400 maximum context length"), { status: 400 })
		);
		mocks.runMcpFlow.mockImplementation(mcpFlow({ error: refused }));

		await expect(collect(makeContext())).rejects.toThrow("data.csv (8,000,000 characters)");
		expect(mocks.generate).not.toHaveBeenCalled();
	});

	it("still falls back when MCP fails before producing output", async () => {
		mocks.runMcpFlow.mockImplementation(mcpFlow({ error: new Error("mcp server down") }));

		await collect(makeContext());

		expect(mocks.generate).toHaveBeenCalledTimes(1);
	});

	it("does not fall back or throw when the user aborts", async () => {
		const ctx = makeContext();
		ctx.abortController.abort();
		mocks.runMcpFlow.mockImplementation(
			mcpFlow({ updates: [STREAM_UPDATE], error: new Error("Request was aborted") })
		);

		await collect(ctx);

		expect(mocks.generate).not.toHaveBeenCalled();
	});
});

describe("activity labels", () => {
	const label: MessageUpdate = {
		type: MessageUpdateType.ActivityLabel,
		round: 0,
		phase: "tools",
		text: "Searching the web",
	};

	it("feeds the tool flow a labeler, streams its labels and finishes it after the turn", async () => {
		let closed = false;
		mocks.createActivityLabeler.mockImplementation(() => ({
			async *updates() {
				yield label;
			},
			close() {
				closed = true;
			},
			async finish() {
				closed = true;
			},
		}));
		mocks.runMcpFlow.mockImplementation(mcpFlow({ updates: [TOOL_UPDATE] }));

		const updates = await collect({
			...makeContext(),
			activity: { labels: true },
			messages: [{ from: "user", content: "Cherche les modèles" }],
		} as unknown as TextGenerationContext);

		expect(updates).toContainEqual(label);
		expect(mocks.runMcpFlow.mock.calls[0][0].activity).toBeDefined();
		expect(mocks.createActivityLabeler.mock.calls[0][0]).toMatchObject({
			userText: "Cherche les modèles",
			labels: true,
		});
		expect(closed).toBe(true);
	});

	it("starts counting rounds after the ones a resumed message already holds", async () => {
		mocks.createActivityLabeler.mockImplementation(() => ({
			// eslint-disable-next-line require-yield
			async *updates() {
				return undefined;
			},
			close() {},
			async finish() {},
		}));
		mocks.runMcpFlow.mockImplementation(mcpFlow({ updates: [TOOL_UPDATE] }));
		const result = (uuid: string): MessageUpdate =>
			({
				type: MessageUpdateType.Tool,
				subtype: MessageToolUpdateType.Result,
				uuid,
				result: { status: "success", call: { name: "hf_fs", parameters: {} }, outputs: [] },
			}) as never;
		const ctx = makeContext();
		const parked = {
			id: "m1",
			from: "assistant",
			content: "",
			updates: [
				{ ...TOOL_UPDATE, uuid: "a" },
				result("a"),
				{ ...TOOL_UPDATE, uuid: "b" },
				result("b"),
			],
		};
		await collect({
			...ctx,
			conv: { ...ctx.conv, messages: [parked] },
			messageId: "m1",
			activity: { labels: true },
		} as unknown as TextGenerationContext);

		expect(mocks.createActivityLabeler.mock.calls[0][0].startRound).toBe(2);
	});

	it("writes no labels for a turn that has them off", async () => {
		mocks.runMcpFlow.mockImplementation(mcpFlow({ updates: [TOOL_UPDATE] }));

		await collect(makeContext());

		expect(mocks.createActivityLabeler).not.toHaveBeenCalled();
		expect(mocks.runMcpFlow.mock.calls[0][0].activity).toBeUndefined();
	});
});
