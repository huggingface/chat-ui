import { describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { OpenAI } from "openai";
import { createHistoryWindow } from "./historyWindow";
import { prepareHistory, type HistoryMessage } from "./prepareFiles";
import type { makeImageProcessor } from "$lib/server/endpoints/images";
import {
	MessageToolUpdateType,
	MessageUpdateType,
	type MessageUpdate,
} from "$lib/types/MessageUpdate";
import { ToolResultStatus } from "$lib/types/Tool";
import type { StoredHistoryWindow } from "$lib/types/Conversation";

type Sent = OpenAI.Chat.Completions.ChatCompletionMessageParam;

const imageProcessor = (() => {
	throw new Error("imageProcessor should not be called in these tests");
}) as unknown as ReturnType<typeof makeImageProcessor>;

const storedTurn = (id: string, rounds: number, outputChars: number): HistoryMessage => ({
	id,
	from: "assistant",
	content: "",
	updates: Array.from({ length: rounds }, (_, i) => [
		{
			type: MessageUpdateType.Tool,
			subtype: MessageToolUpdateType.Call,
			uuid: `${id}r${i}`,
			call: { name: "search", parameters: { q: String(i) } },
		} satisfies MessageUpdate,
		{
			type: MessageUpdateType.Tool,
			subtype: MessageToolUpdateType.Result,
			uuid: `${id}r${i}`,
			result: {
				status: ToolResultStatus.Success,
				call: { name: "search", parameters: {} },
				outputs: [{ text: "s".repeat(outputChars) }],
			},
		} satisfies MessageUpdate,
	]).flat(),
});

const liveRound = (id: string, outputChars: number): Sent[] => [
	{
		role: "assistant",
		tool_calls: [{ id, type: "function", function: { name: "search", arguments: "{}" } }],
	},
	{ role: "tool", tool_call_id: id, content: `${id}:`.padEnd(outputChars, "l") },
];

async function loop(
	history: HistoryMessage[],
	liveMessageId: string,
	stored?: StoredHistoryWindow
) {
	const prepared = await prepareHistory(history, imageProcessor, false, {
		replayToolHistory: true,
		contextLengthTokens: 1_048_576,
		slidingWindow: true,
	});
	if (!prepared.units) throw new Error("expected the sliding window to apply");
	const list: Sent[] = [{ role: "system", content: "SYSTEM" }, ...prepared.messages];
	const saved: StoredHistoryWindow[] = [];
	const window = createHistoryWindow({
		conversationId: new ObjectId(),
		units: prepared.units,
		offset: 1,
		limitChars: 200_000,
		fixedChars: 0,
		liveMessageId,
		stored,
		save: vi.fn(async (_id: ObjectId, start: StoredHistoryWindow) => {
			saved.push(start);
		}),
	});
	return { list, saved, window };
}

const toolIds = (messages: Sent[]) =>
	messages.flatMap((m) => (m.role === "tool" ? [m.tool_call_id] : []));

describe("history window in the tool loop", () => {
	it("slides the request once past the trigger, stores the start and keeps the full list", async () => {
		const { list, saved, window } = await loop(
			[
				{ id: "u0", from: "user", content: "BRIEF" },
				storedTurn("a0", 1, 1_000),
				{ id: "u1", from: "user", content: "GO" },
			],
			"a1"
		);
		const sizes: number[] = [];
		let sent: Sent[] = [];
		for (let round = 0; round < 25; round += 1) {
			list.push(...liveRound(`c${round}`, 10_000));
			sent = await window.fit(list);
			sizes.push(JSON.stringify(sent).length);
		}
		expect(saved.length).toBeGreaterThanOrEqual(2);
		expect(saved.every((start) => start.messageId === "a1")).toBe(true);
		const rounds = saved.map((start) => start.round);
		expect([...rounds].sort((a, b) => a - b)).toEqual(rounds);
		expect(Math.max(...sizes)).toBeLessThan(200_000 * 0.8);

		expect(sent[0]).toEqual({ role: "system", content: "SYSTEM" });
		expect(sent[1]).toMatchObject({ role: "user" });
		expect(String(sent[1].content)).toMatch(/^BRIEF\n\n\[Earlier history omitted: .*\]\n\nGO$/s);
		const lastSaved = saved.at(-1)?.round ?? -1;
		expect(toolIds(sent)).toEqual(
			Array.from({ length: 25 - lastSaved }, (_, i) => `c${lastSaved + i}`)
		);
		expect(list).toHaveLength(1 + 4 + 25 * 2);
	});

	it("does not move the start again until the trigger fires", async () => {
		const { list, saved, window } = await loop(
			[
				{ id: "u0", from: "user", content: "BRIEF" },
				{ id: "u1", from: "user", content: "GO" },
			],
			"a1"
		);
		const starts: string[] = [];
		for (let round = 0; round < 20; round += 1) {
			list.push(...liveRound(`c${round}`, 10_000));
			starts.push(toolIds(await window.fit(list))[0] ?? "");
		}
		const changes = starts.filter((id, i) => i > 0 && id !== starts[i - 1]);
		expect(changes).toHaveLength(saved.length);
	});

	it("numbers live rounds after the rounds the resumed message already stored", async () => {
		const { list, saved, window } = await loop(
			[{ id: "u0", from: "user", content: "BRIEF" }, storedTurn("a0", 3, 60_000)],
			"a0"
		);
		list.push(
			{ role: "assistant", content: "cut off" },
			{ role: "user", content: "[SYSTEM: retry]" }
		);
		for (let round = 0; round < 3; round += 1) {
			list.push(...liveRound(`c${round}`, 60_000));
			await window.fit(list);
		}
		expect(saved).toEqual([
			{ messageId: "a0", round: 3, limitChars: 200_000 },
			{ messageId: "a0", round: 5, limitChars: 200_000 },
		]);
	});

	it("keeps a start chosen for a larger window and ignores one chosen for a smaller one", async () => {
		const history: HistoryMessage[] = [
			{ id: "u0", from: "user", content: "BRIEF" },
			storedTurn("a0", 4, 10_000),
			{ id: "u1", from: "user", content: "GO" },
		];
		const start = { messageId: "a0", round: 2 };

		const larger = await loop(history, "a1", { ...start, limitChars: 400_000 });
		const kept = await larger.window.fit(larger.list);
		expect(String(kept[1].content)).toContain("[Earlier history omitted: 0 turns / 2 tool rounds.");
		expect(toolIds(kept)).toHaveLength(2);

		const smaller = await loop(history, "a1", { ...start, limitChars: 100_000 });
		const recomputed = await smaller.window.fit(smaller.list);
		expect(JSON.stringify(recomputed)).not.toContain("[Earlier history omitted");
		expect(toolIds(recomputed)).toHaveLength(4);
		expect(smaller.saved).toEqual([]);
	});
});
