import type { GenerationStats } from "$lib/types/GenerationStats";

/** llama.cpp (and compatible servers) attach this to the final chunk of a stream. */
interface ProviderTimings {
	prompt_n?: number;
	prompt_ms?: number;
	cache_n?: number;
	predicted_n?: number;
	predicted_ms?: number;
	draft_n?: number;
	draft_n_accepted?: number;
}

interface ProviderUsage {
	prompt_tokens?: number;
	completion_tokens?: number;
	prompt_tokens_details?: { cached_tokens?: number } | null;
}

const num = (value: unknown): number | undefined =>
	typeof value === "number" && Number.isFinite(value) ? value : undefined;

const add = (total: number | undefined, value: number | undefined) =>
	value === undefined ? total : (total ?? 0) + value;

/**
 * Collects GenerationStats for one turn. Feed it every raw chunk of every
 * upstream stream, call endRound() after each stream closes, and read
 * snapshot() when the turn's final answer is emitted.
 */
export function createGenerationStats(startedAt: number = Date.now()) {
	const stats: GenerationStats = { rounds: 0, totalMs: 0 };
	let timings: ProviderTimings | undefined;
	let usage: ProviderUsage | undefined;
	let roundFirstChunkAt: number | undefined;
	let roundLastChunkAt: number | undefined;

	return {
		/** A raw ChatCompletionChunk; anything without timings or usage is just a clock tick. */
		observe(chunk: unknown) {
			const now = Date.now();
			const raw = (chunk ?? {}) as { timings?: unknown; usage?: unknown; choices?: unknown };
			if (raw.timings && typeof raw.timings === "object") timings = raw.timings as ProviderTimings;
			if (raw.usage && typeof raw.usage === "object") usage = raw.usage as ProviderUsage;
			if (Array.isArray(raw.choices) && raw.choices.length > 0) {
				roundFirstChunkAt ??= now;
				roundLastChunkAt = now;
			}
		},
		/** The first token the user sees; only the first call counts. */
		firstToken() {
			stats.firstTokenMs ??= Date.now() - startedAt;
		},
		endRound() {
			stats.rounds += 1;
			if (timings) {
				stats.promptTokens = add(stats.promptTokens, num(timings.prompt_n));
				stats.cachedPromptTokens = add(stats.cachedPromptTokens, num(timings.cache_n));
				stats.outputTokens = add(stats.outputTokens, num(timings.predicted_n));
				stats.prefillMs = add(stats.prefillMs, num(timings.prompt_ms));
				stats.decodeMs = add(stats.decodeMs, num(timings.predicted_ms));
				stats.draftTokens = add(stats.draftTokens, num(timings.draft_n));
				stats.draftAccepted = add(stats.draftAccepted, num(timings.draft_n_accepted));
			} else if (usage) {
				const cached = num(usage.prompt_tokens_details?.cached_tokens);
				const prompt = num(usage.prompt_tokens);
				stats.promptTokens = add(
					stats.promptTokens,
					prompt === undefined ? undefined : prompt - (cached ?? 0)
				);
				stats.cachedPromptTokens = add(stats.cachedPromptTokens, cached);
				stats.outputTokens = add(stats.outputTokens, num(usage.completion_tokens));
				if (roundFirstChunkAt !== undefined && roundLastChunkAt !== undefined) {
					stats.decodeMs = add(stats.decodeMs, roundLastChunkAt - roundFirstChunkAt);
					stats.decodeMeasured = true;
				}
			}
			timings = usage = undefined;
			roundFirstChunkAt = roundLastChunkAt = undefined;
		},
		snapshot(): GenerationStats {
			return { ...stats, totalMs: Date.now() - startedAt };
		},
	};
}
