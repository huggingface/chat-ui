import { describe, expect, it } from "vitest";
import { convertFinishedMessage, convertMessageShape, type ShapeSkipReason } from "./messageShape";
import { messageForStorage } from "./compressUpdates";
import {
	rebuildLegacyContent,
	restoreRunningShape,
	toLegacyShape,
	toolRounds,
} from "$lib/utils/messageShape";
import type { Message } from "$lib/types/Message";
import { MessageUpdateType, type MessageUpdate } from "$lib/types/MessageUpdate";
import {
	assistantMessage,
	convertingTurns,
	finalAnswer,
	preamblesTrimmed,
	stream,
	streamed,
	toolRound,
} from "./__tests__/turnFixtures";

function converted(message: Message): Message {
	const result = convertMessageShape(message);
	if (!("message" in result)) throw new Error(`skipped: ${result.skipped}`);
	return result.message;
}

function skipped(message: Message): ShapeSkipReason | undefined {
	const result = convertMessageShape(message);
	return "skipped" in result ? result.skipped : undefined;
}

function expectRoundTrip(message: Message): Message {
	const next = converted(message);
	expect(next.contentShape).toBe(2);
	expect(rebuildLegacyContent(next)).toEqual({ content: message.content });
	expect(toLegacyShape(next).content).toBe(message.content);
	return next;
}

const roundTexts = (message: Message) =>
	toolRounds(message.updates ?? []).map(({ calls }) => ({
		reasoning: calls[0].reasoning,
		content: calls[0].content,
	}));

describe("convertMessageShape", () => {
	it("moves a plain answer's reasoning out of content", () => {
		const message = assistantMessage(finalAnswer("Weighing it up.", "It is sunny."));
		expect(message.content).toBe("<think>Weighing it up.</think>It is sunny.");

		const next = expectRoundTrip(message);
		expect(next.content).toBe("It is sunny.");
		expect(next.reasoning).toBe("Weighing it up.");
	});

	it("leaves an answer with nothing to move alone", () => {
		expect(skipped(assistantMessage(finalAnswer(undefined, "It is sunny.")))).toBe("unchanged");
	});

	it("keeps each round's reasoning and preamble on its own call, and only the answer in content", () => {
		const message = assistantMessage([
			...toolRound({ reasoning: "I need the weather.", text: "Let me check." }),
			...toolRound({
				reasoning: "Now the forecast.",
				text: "And the forecast.",
				tools: ["a", "b"],
			}),
			...toolRound({ reasoning: "One more look." }),
			...finalAnswer("I have it all.", "Sunny all week."),
		]);

		const next = expectRoundTrip(message);
		expect(next.content).toBe("Sunny all week.");
		expect(next.reasoning).toBe("I have it all.");
		expect(roundTexts(next)).toEqual([
			{ reasoning: "I need the weather.", content: "Let me check." },
			{ reasoning: "Now the forecast.", content: "And the forecast." },
			{ reasoning: "One more look.", content: undefined },
		]);
	});

	it("keeps the whitespace around a preamble, which the stored call trims", () => {
		const message = assistantMessage([
			...toolRound({ reasoning: "Plan.", text: "\n\nLet me check.\n\n" }),
			...toolRound({ text: "\n" }),
			...finalAnswer(undefined, "Done."),
		]);

		const next = expectRoundTrip(message);
		expect(roundTexts(next)).toEqual([
			{ reasoning: "Plan.", content: "\n\nLet me check.\n\n" },
			{ reasoning: undefined, content: "\n" },
		]);
		expect(next.content).toBe("Done.");
	});

	it("keeps a literal </think> a model wrote into its preamble as text", () => {
		const message = assistantMessage([
			...toolRound({ reasoning: "Plan.", text: "Closing the tag </think> for you." }),
			...finalAnswer(undefined, "Done."),
		]);

		expect(roundTexts(expectRoundTrip(message))[0].content).toBe(
			"Closing the tag </think> for you."
		);
	});

	it("round-trips identical rounds of a runaway loop", () => {
		const loop = Array.from({ length: 12 }, () =>
			toolRound({ reasoning: "Check again.", text: "Checking again." })
		).flat();
		const message = assistantMessage([
			...loop,
			...finalAnswer("Still checking.", "Checking again."),
		]);

		const next = expectRoundTrip(message);
		expect(next.content).toBe("Checking again.");
		expect(roundTexts(next)).toHaveLength(12);
	});

	it("converts a turn stopped mid-call, whose answer is empty", () => {
		const rounds = [
			...toolRound({ reasoning: "Plan.", text: "Let me check." }),
			...toolRound({ reasoning: "Again.", unfinished: true }),
		];
		// the route stop sends the text streamed so far
		const shown = rounds.map((u) => (u.type === MessageUpdateType.Stream ? u.token : "")).join("");
		const message = assistantMessage([
			...rounds,
			{ type: MessageUpdateType.FinalAnswer, text: shown, interrupted: true },
		]);

		const next = expectRoundTrip(message);
		expect(next.content).toBe("");
		expect(next.reasoning).toBeUndefined();
	});

	it("skips an answer cut off mid-reasoning", () => {
		const message = assistantMessage([
			...toolRound({ reasoning: "Plan.", text: "Let me check." }),
			stream("<think>Half a thou"),
			{ type: MessageUpdateType.FinalAnswer, text: "<think>Half a thou", interrupted: true },
		]);
		expect(skipped(message)).toBe("final_text");
	});

	it("skips a message stored before rounds kept their reasoning", () => {
		const message = assistantMessage([
			...toolRound({
				reasoning: "I need the weather.",
				text: "Let me check.",
				storesNothing: true,
			}),
			...finalAnswer(undefined, "Sunny."),
		]);
		expect(skipped(message)).toBe("round_text");
	});

	it("skips a round whose reasoning kept arriving after its calls, so never streamed", () => {
		const message = assistantMessage([
			...toolRound({
				reasoning: "I need",
				text: "Let me check.",
				stored: { reasoning: "I need the weather.", content: "Let me check." },
			}),
			...finalAnswer(undefined, "Sunny."),
		]);
		expect(skipped(message)).toBe("round_text");
	});

	it("skips a round that was retried, whose first attempt no call records", () => {
		const message = assistantMessage([
			...toolRound({ reasoning: "Plan.", text: "Let me check." }),
			...streamed("A call too big to finish", "Oops, "),
			...toolRound({ reasoning: "Smaller this time.", text: "Retrying." }),
			...finalAnswer(undefined, "Sunny."),
		]);
		expect(skipped(message)).toBe("round_text");
	});

	it("skips an answer retried after a cut, which holds two think blocks", () => {
		const message = assistantMessage([
			...toolRound({ reasoning: "Plan.", text: "Let me check." }),
			...streamed("Thinking until cut off", ""),
			...finalAnswer("Answer now.", "Sunny."),
		]);
		expect(skipped(message)).toBe("final_text");
	});

	it("skips when the stream markers run past the stored content", () => {
		const message = assistantMessage([
			...toolRound({ reasoning: "Plan.", text: "Let me check." }),
			...finalAnswer(undefined, "Sunny."),
		]);
		expect(skipped({ ...message, content: "Sunny." })).toBe("stream_markers");
	});

	it("skips a message whose reasoning field holds the non-tool path's stream", () => {
		const message = assistantMessage(finalAnswer("Plan.", "Sunny."));
		expect(skipped({ ...message, reasoning: "Streamed separately." })).toBe("legacy_reasoning");
	});

	it("is idempotent", () => {
		const message = assistantMessage(finalAnswer("Plan.", "Sunny."));
		const once = converted(message);
		expect(skipped(once)).toBe("already_converted");
		expect(convertFinishedMessage(once)).toBe(once);
	});

	it("never converts a turn that has not ended", () => {
		const events = [
			...toolRound({ reasoning: "Plan.", text: "Let me check." }),
			...finalAnswer("Done thinking.", "Sunny."),
		];
		for (const end of ["running", "waiting", "awaiting_input"] as const) {
			expect(skipped(assistantMessage(events, end)), end).toBe("not_finished");
		}
		expect(convertFinishedMessage(assistantMessage(events, "done")).contentShape).toBe(2);
		expect(convertFinishedMessage(assistantMessage(events, "failed")).contentShape).toBe(2);
	});

	it("reads a message from before turn states as ended only with an answer since it last started", () => {
		const round = toolRound({ reasoning: "Plan.", text: "Let me check." });
		expect(
			convertFinishedMessage(
				assistantMessage([...round, ...finalAnswer(undefined, "Sunny.")], "legacy")
			).contentShape
		).toBe(2);
		// a park was stamped finished too and its resume continues the content
		expect(skipped(assistantMessage(round, "legacyPark"))).toBe("not_finished");
	});

	it("never touches user messages", () => {
		const user: Message = { ...assistantMessage(finalAnswer("x", "y")), from: "user" };
		expect(skipped(user)).toBe("not_assistant");
	});
});

describe("messageForStorage", () => {
	it("compresses and converts in one step", () => {
		const message = assistantMessage([
			...toolRound({ reasoning: "Plan.", text: "Let me check." }),
			...finalAnswer("Done.", "Sunny."),
		]);
		const raw = { ...message, updates: [...(message.updates ?? []), stream("")] };

		const stored = messageForStorage(raw);
		expect(stored.contentShape).toBe(2);
		expect(stored.content).toBe("Sunny.");
		expect(stored.updates?.some((u) => u.type === MessageUpdateType.Stream && u.token)).toBe(false);
	});
});

describe("what a converted message stores", () => {
	const turn = () =>
		assistantMessage([
			...toolRound({ reasoning: "Plan.", text: "Let me check." }),
			...toolRound({ text: "And again." }),
			...finalAnswer("Done.", "Sunny."),
		]);
	const ofType = (message: Message, type: MessageUpdateType) =>
		(message.updates ?? []).filter((u) => u.type === type);
	const calls = (message: Message) => toolRounds(message.updates ?? []).flatMap((r) => r.calls);

	it("drops the stream markers, the answer text and the parameters argumentsRaw repeats", () => {
		const legacy = turn();
		expect(ofType(legacy, MessageUpdateType.Stream).length).toBeGreaterThan(0);

		const next = converted(legacy);
		expect(ofType(next, MessageUpdateType.Stream)).toEqual([]);
		expect(ofType(next, MessageUpdateType.FinalAnswer)).toEqual([
			{
				type: MessageUpdateType.FinalAnswer,
				text: "",
				len: "<think>Done.</think>Sunny.".length,
				interrupted: false,
			},
		]);
		expect(calls(next).map((u) => u.call.parameters)).toEqual([{}, {}]);
		expect(calls(next).map((u) => u.argumentsRaw)).toEqual([
			'{"city":"Paris"}',
			'{"city":"Paris"}',
		]);
	});

	it("keeps parameters argumentsRaw cannot give back", () => {
		const legacy = turn();
		const [first, second] = calls(legacy);
		delete first.argumentsRaw;
		second.call.parameters = { city: "Lyon" };

		expect(calls(converted(legacy)).map((u) => u.call.parameters)).toEqual([
			{ city: "Paris" },
			{ city: "Lyon" },
		]);
	});

	it("leaves a message that stays in the old shape as it was", () => {
		const legacy = assistantMessage(
			[
				...toolRound({ reasoning: "Plan.", text: "Let me check." }),
				...finalAnswer(undefined, "Sunny."),
			],
			"running"
		);

		const stored = messageForStorage(legacy);
		expect(stored.contentShape).toBeUndefined();
		expect(stored.updates).toEqual(legacy.updates);
	});

	it("slims a message converted before it did, and only once", () => {
		const legacy = turn();
		const unslimmed = { ...converted(legacy), updates: legacy.updates };

		const once = messageForStorage(unslimmed);
		expect(ofType(once, MessageUpdateType.Stream)).toEqual([]);
		expect(calls(once).map((u) => u.call.parameters)).toEqual([{}, {}]);
		expect(messageForStorage(once)).toEqual(once);
		expect(convertFinishedMessage(once)).toBe(once);
	});
});

describe("a turn told of a service end between rounds", () => {
	const event = (afterToolUuid: string): MessageUpdate => ({
		type: MessageUpdateType.HarnessEvent,
		events: [
			{
				serviceId: "svc",
				kind: "job",
				jobId: "0123456789abcdef01234567",
				from: "RUNNING",
				to: "ERROR",
				at: 0,
			},
		],
		text: "[Harness event, not part of this tool result]\nJob 0123456789abcdef01234567 failed: ERROR.",
		afterToolUuid,
	});

	it("stores the event where it was emitted, after its round's results and before the next round", () => {
		const first = toolRound({ reasoning: "Plan.", text: "Let me check." });
		const second = toolRound({ reasoning: "Now the forecast." });
		const calls = toolRounds(first);
		const told = event(calls[0].calls[0].uuid);
		const message = assistantMessage([
			...first,
			told,
			...second,
			...finalAnswer("Done.", "Sunny."),
		]);

		const stored = messageForStorage(message);

		expect(stored.contentShape).toBe(2);
		const updates = stored.updates ?? [];
		const at = updates.indexOf(told);
		expect(at).toBeGreaterThan(-1);
		const rounds = toolRounds(updates);
		expect(at).toBeGreaterThan(rounds[0].start);
		expect(at).toBeLessThan(rounds[1].start);
		expect(roundTexts(stored)).toEqual([
			{ reasoning: "Plan.", content: "Let me check." },
			{ reasoning: "Now the forecast.", content: undefined },
		]);
		expect(rebuildLegacyContent(stored)).toEqual({ content: message.content });
	});
});

describe("restoreRunningShape", () => {
	it("puts a converted message back as the buffer a turn appends to", () => {
		const message = assistantMessage([
			...toolRound({ reasoning: "Plan.", text: "Let me check." }),
			...finalAnswer("Done.", "Sunny."),
		]);
		const next = converted(message);

		restoreRunningShape(next);
		expect(next.content).toBe(message.content);
		expect(next.contentShape).toBeUndefined();
		expect(next.reasoning).toBeUndefined();
	});

	it("puts back the stream markers the next conversion cuts rounds at", () => {
		for (const [name, legacy] of Object.entries(convertingTurns())) {
			const restored = converted(legacy);
			restoreRunningShape(restored);

			expect(preamblesTrimmed(restored), name).toEqual(legacy);
			expect(converted(restored), name).toEqual(converted(legacy));
		}
	});
});
