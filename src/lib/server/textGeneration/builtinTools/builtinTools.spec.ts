import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import type { ElicitationSink } from "$lib/server/mcp/elicitation";

const mocks = vi.hoisted(() => ({
	disableAsk: undefined as string | undefined,
	planningEnabled: undefined as string | undefined,
	openAskPrompt: vi.fn(),
}));

vi.mock("$lib/server/config", () => ({
	config: {
		get DISABLE_ASK_USER_QUESTION() {
			return mocks.disableAsk;
		},
		get PLANNING_ENABLED() {
			return mocks.planningEnabled;
		},
	},
}));

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

const conv = () => ({ _id: new ObjectId() });
const toolNames = (model: Parameters<typeof getEnabledBuiltinTools>[0]["model"]) =>
	getEnabledBuiltinTools({ model, conv: conv() }).map((tool) => tool.name);

beforeEach(() => {
	mocks.disableAsk = undefined;
	mocks.planningEnabled = undefined;
	mocks.openAskPrompt.mockReset();
	mocks.openAskPrompt.mockResolvedValue({ opened: true });
});

describe("getEnabledBuiltinTools", () => {
	it("offers ask_user_question by default and withdraws it on the kill switch", () => {
		expect(toolNames({})).toEqual(["ask_user_question"]);
		mocks.disableAsk = "true";
		expect(toolNames({})).toEqual([]);
	});

	it("offers update_plan on tools-capable models only when the global switch is on", () => {
		expect(toolNames({ supportsTools: true })).not.toContain("update_plan");
		mocks.planningEnabled = "true";
		expect(toolNames({ supportsTools: true })).toContain("update_plan");
		expect(toolNames({ supportsTools: false })).not.toContain("update_plan");
	});

	it("keeps the router alias out of the inferred default", () => {
		mocks.planningEnabled = "true";
		expect(toolNames({ supportsTools: true, isRouter: true })).not.toContain("update_plan");
		// An explicit flag on the alias config still wins.
		expect(toolNames({ supportsTools: true, isRouter: true, supportsPlanning: true })).toContain(
			"update_plan"
		);
	});

	it("lets supportsPlanning override the inferred default in both directions", () => {
		mocks.planningEnabled = "true";
		expect(toolNames({ supportsTools: true, supportsPlanning: false })).not.toContain(
			"update_plan"
		);
		expect(toolNames({ supportsTools: false, supportsPlanning: true })).toContain("update_plan");
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
