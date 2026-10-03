<script lang="ts">
	import IconSparkline from "../icons/IconSparkline.svelte";
	import CarbonClose from "~icons/carbon/close";
	import { trackioViewChipParts, type TrackioDashboardView } from "$lib/utils/trackioView";

	interface Props {
		view: TrackioDashboardView;
		/** Reopens the dashboard at this view. */
		onopen?: () => void;
		/** Present only while the chip is still in the composer. */
		onremove?: () => void;
	}

	let { view, onopen, onremove }: Props = $props();

	let parts = $derived(trackioViewChipParts(view));
	let title = $derived(
		[
			`Project: ${view.project}`,
			`Runs: ${view.runs.map((r) => r.name).join(", ") || "none selected"}`,
			`Charts on screen: ${view.metricsOnScreen.join(", ") || "none"}`,
			onopen ? "Click to show this view in the dashboard" : "",
		]
			.filter(Boolean)
			.join("\n")
	);
</script>

<!-- Orange as ink, like the rest of the ML Intern chrome; the range is the part
     that tells one view from the next, so it alone reads in the body color. -->
<span
	class="inline-flex max-w-full min-w-0 items-center gap-1 rounded-lg border border-[#f5d0b5] bg-[#fff6ef] py-[3px] pr-1 pl-2 text-[12.5px] leading-tight text-[#c4511a] dark:border-[#5a3a22] dark:bg-[#2a1d14] dark:text-[#f0a468] {onremove
		? ''
		: 'pr-2'}"
>
	<button
		type="button"
		class="flex min-w-0 items-center gap-1.5 {onopen ? 'cursor-pointer' : 'cursor-default'}"
		{title}
		aria-label="Dashboard view: {parts.project}, {parts.runs}, {parts.range}"
		onclick={onopen}
	>
		<IconSparkline classNames="size-3.5 shrink-0" />
		<span class="min-w-[2ch] truncate">{parts.project}</span>
		<span aria-hidden="true" class="shrink-0 text-[10px] opacity-60">•</span>
		<span class="shrink-0 whitespace-nowrap">{parts.runs}</span>
		<span aria-hidden="true" class="shrink-0 text-[10px] opacity-60">•</span>
		<span class="shrink-0 whitespace-nowrap text-gray-800 dark:text-gray-100">{parts.range}</span>
	</button>
	{#if onremove}
		<button
			type="button"
			class="flex size-5 shrink-0 items-center justify-center rounded text-gray-400 hover:bg-[#c4511a]/10 hover:text-[#c4511a] dark:hover:bg-[#f0a468]/10 dark:hover:text-[#f0a468]"
			aria-label="Remove dashboard view"
			onclick={onremove}
		>
			<CarbonClose class="size-3" />
		</button>
	{/if}
</span>
