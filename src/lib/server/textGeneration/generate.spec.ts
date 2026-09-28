import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { MessageUpdateType, type MessageUpdate } from "$lib/types/MessageUpdate";
import type { TextGenerationStreamOutputSimplified } from "../endpoints/endpoints";

const mocks = vi.hoisted(() => ({
	summary: vi.fn(),
	loggerError: vi.fn(),
}));

vi.mock("$lib/server/config", () => ({ config: { REASONING_SUMMARY: "true" } }));
vi.mock("./reasoning", () => ({ generateSummaryOfReasoning: mocks.summary }));
vi.mock("../logger", () => ({ logger: { error: mocks.loggerError, info: vi.fn() } }));
vi.mock("../abortedGenerations", () => ({
	AbortedGenerations: { getInstance: () => ({ getAbortTime: () => undefined }) },
}));
vi.mock("../generateFromDefaultEndpoint", () => ({ generateFromDefaultEndpoint: vi.fn() }));

const { generate } = await import("./generate");

const token = (text: string): TextGenerationStreamOutputSimplified => ({
	token: { id: 0, text, logprob: 0, special: false },
	generated_text: null,
	details: null,
});

/**
 * An endpoint that emits reasoning tokens with the clock advanced past the
 * 4s summary interval between them, then the final answer.
 */
function endpointWithReasoning() {
	return async function* () {
		yield token("<think>");
		yield token("first ");
		vi.advanceTimersByTime(5_000);
		yield token("second ");
		yield token("</think>");
		yield token("answer");
		yield {
			token: { id: 0, text: "", logprob: 0, special: true },
			generated_text: "<think>first second </think>answer",
			details: null,
		};
	};
}

async function drain(stream: AsyncIterable<MessageUpdate>) {
	const updates: MessageUpdate[] = [];
	for await (const update of stream) updates.push(update);
	return updates;
}

describe("generate reasoning summaries", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		mocks.summary.mockReset();
		mocks.loggerError.mockReset();
	});
	afterEach(() => vi.useRealTimers());

	it("logs a failed summary instead of leaving the rejection unhandled", async () => {
		mocks.summary.mockRejectedValue(new Error("summary endpoint down"));

		const updates = await drain(
			generate({
				model: {
					id: "test/model",
					name: "test/model",
					parameters: {},
					reasoning: { type: "tokens", beginToken: "<think>", endToken: "</think>" },
				},
				endpoint: endpointWithReasoning(),
				conv: { _id: new ObjectId() },
				messages: [{ from: "user", content: "hi" }],
				promptedAt: new Date(),
				locals: undefined,
				abortController: new AbortController(),
			} as never)
		);

		// The summary was attempted once the interval elapsed…
		expect(mocks.summary).toHaveBeenCalledTimes(1);
		// …its failure was logged rather than escaping as an unhandled rejection…
		expect(mocks.loggerError).toHaveBeenCalledWith(
			expect.objectContaining({ message: "summary endpoint down" }),
			"Error generating summary of reasoning"
		);
		// …and the generation itself still completed normally.
		const final = updates.find((u) => u.type === MessageUpdateType.FinalAnswer);
		expect(final).toMatchObject({ text: "answer", interrupted: false });
	});
});
