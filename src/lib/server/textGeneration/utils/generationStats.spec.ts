import { afterEach, describe, expect, it, vi } from "vitest";
import { createGenerationStats } from "./generationStats";

const choice = { choices: [{ index: 0, delta: { content: "x" } }] };

afterEach(() => vi.useRealTimers());

describe("createGenerationStats", () => {
	it("sums llama.cpp timings across tool rounds", () => {
		const stats = createGenerationStats();
		stats.observe(choice);
		stats.observe({
			...choice,
			timings: {
				prompt_n: 100,
				prompt_ms: 500,
				cache_n: 20,
				predicted_n: 50,
				predicted_ms: 1000,
				draft_n: 40,
				draft_n_accepted: 30,
			},
		});
		stats.endRound();
		stats.observe({
			...choice,
			timings: { prompt_n: 10, prompt_ms: 50, predicted_n: 5, predicted_ms: 100 },
		});
		stats.endRound();

		expect(stats.snapshot()).toMatchObject({
			rounds: 2,
			promptTokens: 110,
			cachedPromptTokens: 20,
			prefillMs: 550,
			outputTokens: 55,
			decodeMs: 1100,
			draftTokens: 40,
			draftAccepted: 30,
		});
		expect(stats.snapshot().decodeMeasured).toBeUndefined();
	});

	it("falls back to usage, excluding cached tokens and timing the decode itself", () => {
		vi.useFakeTimers();
		const stats = createGenerationStats(Date.now());
		vi.advanceTimersByTime(300);
		stats.observe(choice);
		stats.firstToken();
		vi.advanceTimersByTime(2000);
		stats.observe({
			...choice,
			usage: {
				prompt_tokens: 1000,
				completion_tokens: 80,
				prompt_tokens_details: { cached_tokens: 900 },
			},
		});
		stats.endRound();

		expect(stats.snapshot()).toEqual({
			rounds: 1,
			promptTokens: 100,
			cachedPromptTokens: 900,
			outputTokens: 80,
			decodeMs: 2000,
			decodeMeasured: true,
			firstTokenMs: 300,
			totalMs: 2300,
		});
	});

	it("reports only the round count and wall clock when the provider sends nothing", () => {
		const stats = createGenerationStats();
		stats.observe(choice);
		stats.endRound();

		const snapshot = stats.snapshot();
		expect(snapshot.rounds).toBe(1);
		expect(snapshot.promptTokens).toBeUndefined();
		expect(snapshot.outputTokens).toBeUndefined();
		expect(snapshot.decodeMs).toBeUndefined();
	});
});
