/**
 * How long one assistant turn took and how many tokens it moved, summed over
 * every upstream call the turn made (one per tool round). Token counts and
 * prefill/decode times come from the provider: llama.cpp-style `timings` when
 * present, OpenAI `usage` otherwise. A provider that sends neither leaves
 * everything but the wall-clock fields unset.
 */
export interface GenerationStats {
	/** Upstream completions this turn made. */
	rounds: number;
	/** Prompt tokens actually processed, i.e. not served from the provider's cache. */
	promptTokens?: number;
	cachedPromptTokens?: number;
	outputTokens?: number;
	/** Provider-reported prefill time (`timings` only). */
	prefillMs?: number;
	/**
	 * Decode time: provider-reported with `timings`, otherwise measured here
	 * from each round's first to last streamed chunk.
	 */
	decodeMs?: number;
	decodeMeasured?: boolean;
	/** Speculative decoding: tokens drafted and how many the model accepted. */
	draftTokens?: number;
	draftAccepted?: number;
	/** Wall clock from the request to the first streamed token. */
	firstTokenMs?: number;
	/** Wall clock for the whole turn, tool execution included. */
	totalMs: number;
}
