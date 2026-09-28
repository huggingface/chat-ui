import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { MessageUpdateType } from "$lib/types/MessageUpdate";
import type { PlanState, PlanStep } from "$lib/types/Plan";

const dbMock = vi.hoisted(() => ({ updateOne: vi.fn() }));
vi.mock("$lib/server/database", () => ({
	collections: { conversations: { updateOne: dbMock.updateOne } },
}));
vi.mock("$lib/server/logger", () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { parsePlanArgs, renderPlanBlock, injectPlanState, createPlanTool, PLAN_TOOL_NAME } =
	await import("./planTool");

const ctx = { uuid: "uuid-1", toolCallId: "call_plan" };

const validSteps: PlanStep[] = [
	{ step: "write the types", status: "completed" },
	{ step: "wire the dispatch", status: "in_progress" },
	{ step: "add tests", status: "pending" },
];
const validArgs = { goal: "Ship the plan tool", steps: validSteps };

beforeEach(() => {
	dbMock.updateOne.mockReset();
	dbMock.updateOne.mockResolvedValue({ acknowledged: true });
});

describe("parsePlanArgs", () => {
	it("accepts a well-formed plan", () => {
		const parsed = parsePlanArgs(validArgs);
		expect(parsed.ok).toBe(true);
		if (parsed.ok) {
			expect(parsed.goal).toBe("Ship the plan tool");
			expect(parsed.steps).toHaveLength(3);
		}
	});

	it("rejects a plan with no goal, naming the field", () => {
		const parsed = parsePlanArgs({ steps: validArgs.steps });
		expect(parsed.ok).toBe(false);
		if (!parsed.ok) expect(parsed.error).toContain("goal");
	});

	it("rejects an empty step list and an unknown status", () => {
		expect(parsePlanArgs({ goal: "g", steps: [] }).ok).toBe(false);
		expect(parsePlanArgs({ goal: "g", steps: [{ step: "a", status: "done" }] }).ok).toBe(false);
	});

	it("rejects a plan with too many steps", () => {
		const steps = Array.from({ length: 21 }, (_, i) => ({
			step: `step ${i}`,
			status: "pending",
		}));
		expect(parsePlanArgs({ goal: "g", steps }).ok).toBe(false);
	});

	it("keeps the first in_progress step and demotes the rest", () => {
		// A malformed status split is a prompt violation, not a reason to lose the update.
		const parsed = parsePlanArgs({
			goal: "g",
			steps: [
				{ step: "a", status: "in_progress" },
				{ step: "b", status: "in_progress" },
			],
		});
		expect(parsed.ok).toBe(true);
		if (parsed.ok) {
			expect(parsed.steps.map((s) => s.status)).toEqual(["in_progress", "pending"]);
		}
	});

	it("truncates oversized step text instead of rejecting it", () => {
		const parsed = parsePlanArgs({
			goal: "g",
			steps: [{ step: "x".repeat(500), status: "pending" }],
		});
		expect(parsed.ok).toBe(true);
		if (parsed.ok) expect(parsed.steps[0].step.length).toBeLessThanOrEqual(200);
	});

	it("keeps a step label, truncated, and drops a blank one", () => {
		const parsed = parsePlanArgs({
			goal: "g",
			steps: [
				{ step: "run the baseline", label: "Baseline eval", status: "pending" },
				{ step: "train", label: "y".repeat(60), status: "pending" },
				{ step: "compare", label: "   ", status: "pending" },
				{ step: "report", status: "pending" },
			],
		});
		expect(parsed.ok).toBe(true);
		if (parsed.ok) {
			expect(parsed.steps[0].label).toBe("Baseline eval");
			expect(parsed.steps[1].label?.length).toBeLessThanOrEqual(24);
			expect(parsed.steps[2].label).toBeUndefined();
			expect(parsed.steps[3].label).toBeUndefined();
		}
	});
});

describe("renderPlanBlock", () => {
	it("renders version, progress, goal and status markers", () => {
		const block = renderPlanBlock({ goal: "Ship it", version: 3, steps: validArgs.steps });
		expect(block).toContain("PLAN (v3 — 1/3 done)");
		expect(block).toContain("Goal: Ship it");
		expect(block).toContain("1. [x] write the types");
		expect(block).toContain("2. [>] wire the dispatch");
		expect(block).toContain("3. [ ] add tests");
	});

	it("reports steps the size cap cut off instead of dropping them silently", () => {
		const steps = Array.from({ length: 20 }, (_, i) => ({
			step: `${i}: ${"x".repeat(150)}`,
			status: "pending" as const,
		}));
		const block = renderPlanBlock({ goal: "g", version: 1, steps });
		expect(block.length).toBeLessThanOrEqual(2100);
		expect(block).toMatch(/…and \d+ more steps \(truncated\)/);
	});
});

describe("injectPlanState", () => {
	const plan: PlanState = {
		goal: "Ship it",
		steps: [{ step: "a", status: "pending" }],
		version: 1,
		updatedAt: new Date(),
	};

	it("appends to the last user message, not an earlier one", () => {
		const messages: ChatCompletionMessageParam[] = [
			{ role: "user", content: "first" },
			{ role: "assistant", content: "reply" },
			{ role: "user", content: "second" },
		];
		const updated = injectPlanState(messages, plan);
		expect(String(updated[0].content)).toBe("first");
		expect(String(updated[2].content)).toContain("second");
		expect(String(updated[2].content)).toContain("CURRENT PLAN");
	});

	it("adds a text part to a multimodal user message without touching its images", () => {
		const messages: ChatCompletionMessageParam[] = [
			{
				role: "user",
				content: [
					{ type: "text", text: "look" },
					{ type: "image_url", image_url: { url: "data:image/png;base64,x" } },
				],
			},
		];
		const updated = injectPlanState(messages, plan);
		const content = updated[0].content;
		expect(Array.isArray(content)).toBe(true);
		if (Array.isArray(content)) {
			expect(content).toHaveLength(3);
			expect(content[1]).toMatchObject({ type: "image_url" });
			expect(content[2]).toMatchObject({ type: "text" });
		}
	});

	it("leaves the messages alone when there is no user message", () => {
		const messages: ChatCompletionMessageParam[] = [{ role: "system", content: "sys" }];
		expect(injectPlanState(messages, plan)).toEqual(messages);
	});
});

describe("createPlanTool execute", () => {
	it("bumps the version, persists with a targeted $set, and mutates the conversation", async () => {
		const conv = {
			_id: new ObjectId(),
			plan: { goal: "old", steps: [], version: 4, updatedAt: new Date() } as PlanState,
		};
		const tool = createPlanTool(conv);
		expect(tool.name).toBe(PLAN_TOOL_NAME);

		const outcome = await tool.execute(validArgs, ctx);

		expect(dbMock.updateOne).toHaveBeenCalledTimes(1);
		const [filter, update] = dbMock.updateOne.mock.calls[0] as [
			{ _id: ObjectId },
			{ $set: { plan: PlanState } },
		];
		expect(filter._id).toBe(conv._id);
		expect(update.$set.plan.version).toBe(5);
		expect(conv.plan?.version).toBe(5);

		expect("resultText" in outcome && outcome.resultText).toContain("PLAN (v5 — 1/3 done)");
		if ("extraUpdates" in outcome) {
			expect(outcome.extraUpdates?.[0]).toMatchObject({
				type: MessageUpdateType.Plan,
				uuid: "uuid-1",
				goal: "Ship the plan tool",
				version: 5,
			});
		}
	});

	it("carries the model's explanation into the plan update", async () => {
		const tool = createPlanTool({ _id: new ObjectId() });
		const outcome = await tool.execute({ ...validArgs, explanation: "started wiring" }, ctx);
		if ("extraUpdates" in outcome) {
			expect(outcome.extraUpdates?.[0]).toMatchObject({ explanation: "started wiring" });
		} else {
			throw new Error("expected a result");
		}
	});

	it("returns a model-readable error on invalid arguments without writing anything", async () => {
		const tool = createPlanTool({ _id: new ObjectId() });
		const outcome = await tool.execute({ goal: "", steps: [] }, ctx);
		expect("error" in outcome).toBe(true);
		expect(dbMock.updateOne).not.toHaveBeenCalled();
	});

	it("fails the call and leaves the in-memory plan untouched when the write fails", async () => {
		dbMock.updateOne.mockRejectedValue(new Error("db down"));
		const conv = { _id: new ObjectId(), plan: undefined as PlanState | undefined };
		const tool = createPlanTool(conv);

		const outcome = await tool.execute(validArgs, ctx);

		expect("error" in outcome && outcome.error).toContain("could not be saved");
		expect(conv.plan).toBeUndefined();
	});
});
