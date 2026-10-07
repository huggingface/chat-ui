<script lang="ts">
	import IconSparkline from "../icons/IconSparkline.svelte";
	import { trackioViewChipParts, type TrackioDashboardView } from "$lib/utils/trackioView";

	interface Props {
		view: TrackioDashboardView;
		onopen?: () => void;
		inline?: boolean;
	}

	let { view, onopen, inline = false }: Props = $props();

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

<span
	class={[
		"inline-flex max-w-full min-w-0 items-center gap-1 text-[#c4511a] dark:text-[#f0a468]",
		inline
			? "rounded bg-[#c4511a]/10 px-0.5 align-[-0.15em] dark:bg-[#f0a468]/[.13]"
			: "rounded-lg border border-[#f5d0b5] bg-[#fff6ef] px-2 py-[3px] text-[12.5px] leading-tight dark:border-[#5a3a22] dark:bg-[#2a1d14]",
	]}
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
		<span class="shrink-0 whitespace-nowrap">{parts.range}</span>
	</button>
</span>
