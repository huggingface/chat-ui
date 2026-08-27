<script lang="ts">
	import CarbonTime from "~icons/carbon/time";
	import { serverCorrectedNow } from "$lib/utils/clockSkew.svelte";

	interface Props {
		/** Absolute deadline, epoch ms (server clock). */
		until: number;
		reason?: string;
	}

	let { until, reason }: Props = $props();

	// Past the deadline by more than the sweeper's cadence, "counting down" would
	// be a lie — say what is actually happening instead.
	const OVERDUE_GRACE_MS = 15_000;

	let now = $state(serverCorrectedNow());
	$effect(() => {
		const timer = setInterval(() => {
			now = serverCorrectedNow();
		}, 1000);
		return () => clearInterval(timer);
	});

	let remainingMs = $derived(until - now);
	let overdue = $derived(remainingMs < -OVERDUE_GRACE_MS);

	function formatRemaining(ms: number): string {
		const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
		const minutes = Math.floor(totalSeconds / 60);
		const seconds = totalSeconds % 60;
		return `${minutes}:${String(seconds).padStart(2, "0")}`;
	}
</script>

<div
	role="status"
	data-exclude-from-copy
	class="mt-2 flex w-fit items-center gap-1.5 rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-xs text-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400"
>
	<CarbonTime class="text-[0.8rem] {overdue ? '' : 'animate-pulse'}" />
	{#if overdue}
		<span>Waiting{reason ? ` for ${reason}` : ""} — overdue, waking…</span>
	{:else}
		<span>
			Waiting{reason ? ` for ${reason}` : ""} — resumes in
			<span class="font-mono tabular-nums">{formatRemaining(remainingMs)}</span>
		</span>
	{/if}
</div>
