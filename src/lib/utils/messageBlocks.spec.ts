import { describe, expect, it } from "vitest";
import { messageBlocks, type MessageBlock } from "./messageBlocks";
import { restoreRunningShape } from "./messageShape";
import { convertingTurns } from "$lib/server/generation/__tests__/turnFixtures";
import { messageForStorage } from "$lib/server/generation/compressUpdates";
import {
	MessageElicitationUpdateType,
	MessageReviewUpdateType,
	MessageToolUpdateType,
	MessageUpdateType,
	type MessageUpdate,
} from "$lib/types/MessageUpdate";

function shown(blocks: MessageBlock[]) {
	return blocks.map((block) => {
		switch (block.type) {
			case "tool":
				return { tool: block.uuid, updates: block.updates.map((update) => update.subtype) };
			case "artifact":
				return { artifact: block.op.identifier, opIndex: block.opIndex };
			case "elicitation":
				return { question: block.request.elicitationId, answered: block.resolved?.action };
			case "plan":
				return { plan: block.update.version };
			case "harnessEvent":
				return { event: block.update.afterToolUuid };
			default:
				return block;
		}
	});
}

describe.each(Object.entries(convertingTurns()))("%s", (_name, legacy) => {
	const stored = messageForStorage(legacy);

	it("is stored in the rounds shape, with nothing left to place text by", () => {
		expect(stored.contentShape).toBe(2);
		expect(stored.updates?.some((u) => u.type === MessageUpdateType.Stream)).toBe(false);
	});

	it("renders the same blocks as its legacy form", () => {
		const blocks = shown(messageBlocks(legacy));
		expect(blocks.length).toBeGreaterThan(0);
		expect(shown(messageBlocks(stored))).toEqual(blocks);
	});

	it("renders the same blocks once restored for a turn that continues", () => {
		const restored = structuredClone(stored);
		restoreRunningShape(restored);
		expect(restored.contentShape).toBeUndefined();
		expect(shown(messageBlocks(restored))).toEqual(shown(messageBlocks(legacy)));
	});
});

it("keeps a question, a plan card and a harness event where the legacy form had them", () => {
	const turns = convertingTurns();
	const kinds = (name: string) =>
		messageBlocks(messageForStorage(turns[name])).map((block) => block.type);

	expect(kinds("a question answered mid-turn")).toEqual([
		"think",
		"tool",
		"elicitation",
		"think",
		"text",
		"tool",
		"text",
	]);
	expect(kinds("a job ended mid-turn")).toEqual([
		"think",
		"text",
		"tool",
		"harnessEvent",
		"think",
		"tool",
		"text",
	]);
	expect(kinds("plan updates")).toEqual([
		"think",
		"text",
		"tool",
		"think",
		"plan",
		"think",
		"text",
	]);
});

describe("a review card", () => {
	const call = (uuid: string): MessageUpdate => ({
		type: MessageUpdateType.Tool,
		subtype: MessageToolUpdateType.Call,
		uuid,
		call: { name: "request_review", parameters: {} },
	});
	const request: MessageUpdate = {
		type: MessageUpdateType.Review,
		subtype: MessageReviewUpdateType.Request,
		reviewId: "r1",
		toolUuid: "u1",
		title: "triage batch 1",
		records: 30,
		questions: 2,
		mode: "label",
	};

	it("stands for its call, the result that resumes the turn included", () => {
		const blocks = messageBlocks({
			content: "",
			updates: [
				call("u1"),
				request,
				{
					type: MessageUpdateType.Review,
					subtype: MessageReviewUpdateType.Resolved,
					reviewId: "r1",
					answered: 30,
					skipped: 0,
					comments: 2,
					files: [{ name: "reviews/triage.responses.jsonl", version: 1 }],
				},
				{
					type: MessageUpdateType.Elicitation,
					subtype: MessageElicitationUpdateType.Resolved,
					elicitationId: "e1",
					action: "accept",
					resolution: "user",
				},
				{
					type: MessageUpdateType.Tool,
					subtype: MessageToolUpdateType.Result,
					uuid: "u1",
					result: {
						status: "success",
						call: { name: "request_review", parameters: {} },
						outputs: [],
					},
				} as MessageUpdate,
				{ type: MessageUpdateType.Stream, token: "Thanks." },
			],
		});
		expect(blocks.map((block) => block.type)).toEqual(["review", "text"]);
		const review = blocks[0];
		expect(review.type === "review" && review.resolved?.answered).toBe(30);
	});

	it("leaves a refused call its tool card", () => {
		const blocks = messageBlocks({
			content: "",
			updates: [
				call("u2"),
				{
					type: MessageUpdateType.Tool,
					subtype: MessageToolUpdateType.Error,
					uuid: "u2",
					message: "request_review was not shown: record 14: body must be a string",
				},
			],
		});
		expect(blocks.map((block) => block.type)).toEqual(["tool"]);
	});
});
