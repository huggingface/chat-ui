<script lang="ts">
	import { paperQuoteLabel, type PaperQuote } from "$lib/utils/paper";
	import LucideQuote from "~icons/lucide/quote";

	interface Props {
		quote: PaperQuote;
		onopen?: () => void;
		inline?: boolean;
	}

	let { quote, onopen, inline = false }: Props = $props();

	let label = $derived(paperQuoteLabel(quote));
	let title = $derived(
		[
			quote.title ? `${quote.title}, page ${quote.page}` : `Page ${quote.page}`,
			quote.verified === false ? "(not found on that page of the PDF)" : "",
			"",
			quote.text.length > 600 ? `${quote.text.slice(0, 600)}…` : quote.text,
			onopen ? "\nClick to show it in the paper" : "",
		]
			.filter((line, i) => line || i === 2)
			.join("\n")
	);
</script>

<span
	class={[
		"inline-flex max-w-full min-w-0 items-center gap-1 text-teal-700 dark:text-teal-300",
		inline
			? "rounded bg-teal-700/10 px-0.5 align-[-0.15em] dark:bg-teal-300/[.12]"
			: "rounded-lg border border-teal-200 bg-teal-50 px-2 py-[3px] text-[12.5px] leading-tight dark:border-teal-900 dark:bg-teal-950/40",
	]}
>
	<button
		type="button"
		class="flex min-w-0 items-center gap-1.5 {onopen ? 'cursor-pointer' : 'cursor-default'}"
		{title}
		aria-label="Quote from {quote.title ?? quote.paperId}, {label}"
		onclick={(e) => {
			e.stopPropagation();
			onopen?.();
		}}
	>
		<LucideQuote class="size-3.5 shrink-0" />
		<span class="min-w-[2ch] truncate">{label}</span>
	</button>
</span>
