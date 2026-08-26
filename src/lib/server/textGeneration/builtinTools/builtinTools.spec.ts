import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import type { ElicitationSink } from "$lib/server/mcp/elicitation";

const mocks = vi.hoisted(() => ({
	openAskPrompt: vi.fn(),
}));

// The gate itself is real; only the build flag behind it is forced on.
vi.mock("$lib/utils/mlAssistantFlag", () => ({ ML_ASSISTANT_MODE: true }));

vi.mock("$lib/server/askUserQuestion", () => ({
	ASK_USER_QUESTION_TOOL_NAME: "ask_user_question",
	askUserQuestionTool: { type: "function", function: { name: "ask_user_question" } },
	openAskPrompt: mocks.openAskPrompt,
}));

vi.mock("$lib/server/database", () => ({
	collections: { conversations: { updateOne: vi.fn() } },
}));
vi.mock("$lib/server/logger", () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { getEnabledBuiltinTools, shouldSkipMcpFlow } = await import("./index");
const { askUserQuestionBuiltin } = await import("./askUserQuestion");

const toolNames = (conv: Parameters<typeof getEnabledBuiltinTools>[0]["conv"]) =>
	getEnabledBuiltinTools({ conv }).map((tool) => tool.name);

beforeEach(() => {
	mocks.openAskPrompt.mockReset();
	mocks.openAskPrompt.mockResolvedValue({ opened: true });
});

describe("getEnabledBuiltinTools", () => {
	it("offers both builtin tools in an ML Assistant conversation", () => {
		expect(toolNames({ _id: new ObjectId(), mlAssistant: true })).toEqual([
			"ask_user_question",
			"update_plan",
			"wait",
		]);
	});

	it("offers nothing outside the mode", () => {
		expect(toolNames({ _id: new ObjectId() })).toEqual([]);
		expect(toolNames({ _id: new ObjectId(), mlAssistant: false })).toEqual([]);
	});
});

describe("shouldSkipMcpFlow", () => {
	it("skips only when there is neither a server nor a builtin tool", () => {
		expect(shouldSkipMcpFlow(0, 0)).toBe(true);
		expect(shouldSkipMcpFlow(1, 0)).toBe(false);
		expect(shouldSkipMcpFlow(0, 1)).toBe(false);
		expect(shouldSkipMcpFlow(2, 3)).toBe(false);
	});
});

describe("askUserQuestionBuiltin", () => {
	const sink: ElicitationSink = { conversationId: new ObjectId(), emit: vi.fn() };
	const args = { questions: [] };

	it("opens the prompt through the sink and parks", async () => {
		const outcome = await askUserQuestionBuiltin.execute(args, {
			uuid: "u1",
			toolCallId: "c1",
			messageId: "m1",
			elicitationSink: sink,
		});

		expect(outcome).toEqual({ awaitingInput: true });
		expect(mocks.openAskPrompt).toHaveBeenCalledWith({
			sink,
			toolUuid: "u1",
			toolCallId: "c1",
			messageId: "m1",
			args,
		});
	});

	it("surfaces the reason when the prompt cannot be shown", async () => {
		mocks.openAskPrompt.mockResolvedValue({ opened: false, reason: "no questions were given" });
		const outcome = await askUserQuestionBuiltin.execute(args, {
			uuid: "u1",
			toolCallId: "c1",
			elicitationSink: sink,
		});
		expect("error" in outcome && outcome.error).toContain("no questions were given");
	});

	it("errors without opening anything when there is no chat to ask", async () => {
		const outcome = await askUserQuestionBuiltin.execute(args, { uuid: "u1", toolCallId: "c1" });
		expect(mocks.openAskPrompt).not.toHaveBeenCalled();
		expect("error" in outcome && outcome.error).toContain("no chat to ask");
	});
});
