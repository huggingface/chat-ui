<script lang="ts">
	import type { GenerationStats } from "$lib/types/GenerationStats";

	interface Props {
		stats: GenerationStats;
	}

	let { stats }: Props = $props();

	let open = $state(false);

	const count = (n: number) => n.toLocaleString("en-US");
	const seconds = (ms: number) => `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
	const perSecond = (tokens: number | undefined, ms: number | undefined) =>
		tokens !== undefined && ms ? tokens / (ms / 1000) : undefined;
	const speed = (rate: number) => `${rate.toFixed(rate < 100 ? 1 : 0)} tok/s`;
	// The collapsed line has to fit one phone-width row.
	const shortSpeed = (rate: number) =>
		`${rate < 1000 ? rate.toFixed(rate < 100 ? 1 : 0) : `${(rate / 1000).toFixed(1)}k`} t/s`;
	const join = (parts: (string | false | undefined)[]) =>
		parts.filter((part): part is string => Boolean(part)).join(" · ");

	let prefillRate = $derived(perSecond(stats.promptTokens, stats.prefillMs));
	let decodeRate = $derived(perSecond(stats.outputTokens, stats.decodeMs));

	// Data a provider never sent is left out rather than shown as zero.
	let summary = $derived(
		join([
			prefillRate !== undefined && `Prefill ${shortSpeed(prefillRate)}`,
			decodeRate !== undefined && `Decode ${shortSpeed(decodeRate)}`,
			stats.outputTokens !== undefined && `${count(stats.outputTokens)} tok`,
			seconds(stats.totalMs),
		])
	);

	let rows = $derived(
		[
			stats.promptTokens !== undefined && [
				"Prefill",
				join([
					`${count(stats.promptTokens)} tok`,
					stats.prefillMs !== undefined && seconds(stats.prefillMs),
					prefillRate !== undefined && speed(prefillRate),
					stats.cachedPromptTokens ? `+${count(stats.cachedPromptTokens)} cached` : undefined,
				]),
			],
			stats.outputTokens !== undefined && [
				"Decode",
				join([
					`${count(stats.outputTokens)} tok`,
					stats.decodeMs !== undefined && seconds(stats.decodeMs),
					decodeRate !== undefined &&
						`${speed(decodeRate)}${stats.decodeMeasured ? " (measured)" : ""}`,
				]),
			],
			stats.draftTokens
				? [
						"Drafts",
						`${count(stats.draftAccepted ?? 0)} of ${count(stats.draftTokens)} accepted · ${Math.round(
							((stats.draftAccepted ?? 0) / stats.draftTokens) * 100
						)}%`,
					]
				: undefined,
			stats.firstTokenMs !== undefined && ["First token", seconds(stats.firstTokenMs)],
			["Total", join([seconds(stats.totalMs), stats.rounds > 1 && `${stats.rounds} model calls`])],
		].filter((row): row is string[] => Array.isArray(row))
	);
</script>

<div data-exclude-from-copy class="text-[.7rem] text-gray-400 tabular-nums dark:text-gray-500">
	<button
		type="button"
		class="text-left whitespace-nowrap hover:text-gray-500 dark:hover:text-gray-400"
		aria-expanded={open}
		onclick={() => (open = !open)}
	>
		{summary}
	</button>
	{#if open}
		<dl class="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
			{#each rows as [label, value] (label)}
				<dt>{label}</dt>
				<dd>{value}</dd>
			{/each}
		</dl>
	{/if}
</div>
