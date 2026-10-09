import { describe, expect, it } from "vitest";
import { messageBlocks, type MessageBlock } from "./messageBlocks";
import { restoreRunningShape } from "./messageShape";
import { convertingTurns } from "$lib/server/generation/__tests__/turnFixtures";
import { messageForStorage } from "$lib/server/generation/compressUpdates";
import { MessageUpdateType } from "$lib/types/MessageUpdate";

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

describe("tool rounds on blocks", () => {
	const rounds = (message: Parameters<typeof messageBlocks>[0]) =>
		messageBlocks(message)
			.filter((block) => block.type === "think" || block.type === "tool")
			.map((block) => [block.type, block.round]);

	it.each(Object.entries(convertingTurns()))(
		"%s: the same in its stored shape",
		(_name, legacy) => {
			expect(rounds(messageForStorage(legacy))).toEqual(rounds(legacy));
		}
	);

	it("gives reasoning the round of the calls that follow it while a turn streams", () => {
		const stream = (token: string) => ({ type: MessageUpdateType.Stream, token }) as const;
		const call = (uuid: string) =>
			({
				type: MessageUpdateType.Tool,
				subtype: "call",
				uuid,
				call: { name: "web_search_exa", parameters: {} },
			}) as never;
		const result = (uuid: string) =>
			({
				type: MessageUpdateType.Tool,
				subtype: "result",
				uuid,
				result: {
					status: "success",
					call: { name: "web_search_exa", parameters: {} },
					outputs: [],
				},
			}) as never;
		const updates = [
			stream("<think>Search both boards</think>"),
			call("a"),
			call("b"),
			result("a"),
			result("b"),
			stream("<think>Now the model cards</think>Checking the cards."),
			call("c"),
			result("c"),
			stream("<think>Enough to answer</think>Here is the table."),
		];
		expect(rounds({ content: "", updates })).toEqual([
			["think", 0],
			["tool", 0],
			["tool", 0],
			["think", 1],
			["tool", 1],
			["think", 2],
		]);
	});
});
