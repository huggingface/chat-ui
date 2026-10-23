<script lang="ts">
	import MarkdownRenderer from "$lib/components/chat/MarkdownRenderer.svelte";
	import type { ReviewQuote } from "$lib/types/MlReview";
	import { jsonSummary, parseJsonText, unpackJson } from "$lib/utils/review/json";
	import { quoteAt } from "$lib/utils/review/view";
	import JsonView from "./JsonView.svelte";
	import {
		offerSelectionComment,
		offsetsWithin,
		quoteAnchors,
		type AnchoredQuote,
	} from "../quoteAnchors";

	import CarbonAddComment from "~icons/carbon/add-comment";

	interface Props {
		value: string;
		markdown?: boolean;
		clamp?: boolean;
		quotes?: AnchoredQuote[];
		onanchors?: (lost: string[]) => void;
		/** offers a comment on a selection inside the field when set */
		oncomment?: (quote: ReviewQuote) => void;
	}

	let {
		value,
		markdown = false,
		clamp = false,
		quotes = [],
		onanchors = () => {},
		oncomment,
	}: Props = $props();

	/** a text cell holding JSON renders as structure, the raw toggle shows it as stored */
	let parsed = $derived(markdown ? undefined : parseJsonText(value));
	let structured = $derived(parsed === undefined ? undefined : unpackJson(parsed));
	let raw = $state(false);

	/** room the popup needs above the selection before it flips below */
	const POPUP_ROOM = 36;

	let wrapper: HTMLElement | undefined = $state();
	let element: HTMLElement | undefined = $state();
	let pending = $state<{ quote: ReviewQuote; x: number; y: number; below: boolean } | undefined>(
		undefined
	);

	$effect(() => {
		if (!pending) return;
		offerSelectionComment(comment);
		return () => offerSelectionComment(undefined);
	});

	function selectedRange(): Range | undefined {
		const selection = window.getSelection();
		if (!selection || selection.isCollapsed || selection.rangeCount === 0) return undefined;
		return selection.getRangeAt(0);
	}

	function readSelection() {
		if (!oncomment || !element || !wrapper) return;
		const range = selectedRange();
		const offsets = range && offsetsWithin(element, range);
		if (!range || !offsets) {
			pending = undefined;
			return;
		}
		const rect = range.getBoundingClientRect();
		const box = wrapper.getBoundingClientRect();
		const below = rect.top - box.top < POPUP_ROOM;
		pending = {
			quote: quoteAt(element.textContent ?? "", offsets.start, offsets.end),
			x: Math.min(Math.max(rect.left - box.left + rect.width / 2, 0), box.width),
			y: below ? rect.bottom - box.top : rect.top - box.top,
			below,
		};
	}

	// a deselect anywhere in the page, not only in this field, takes the popup down
	function dropStaleSelection() {
		if (!pending || !element) return;
		const range = selectedRange();
		if (!range || !offsetsWithin(element, range)) pending = undefined;
	}

	function comment() {
		if (!pending || !oncomment) return;
		const { quote } = pending;
		pending = undefined;
		oncomment(quote);
	}
</script>

<svelte:document onselectionchange={dropStaleSelection} />

<div bind:this={wrapper} class="relative min-w-0">
	{#if structured !== undefined && !clamp}
		<button
			type="button"
			class="mb-1 rounded-md px-1.5 py-0.5 font-mono text-[11px] text-gray-500 hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
			aria-pressed={raw}
			data-json-raw-toggle
			onclick={() => (raw = !raw)}
		>
			{raw ? "Formatted" : "Raw"}
		</button>
	{/if}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		bind:this={element}
		data-review-quotable
		class={[
			"min-w-0 text-[15px] leading-[1.65] text-gray-700 dark:text-gray-300",
			markdown
				? "prose max-w-none text-[15px] leading-[1.65] dark:prose-invert prose-headings:text-[15px] prose-headings:font-semibold prose-pre:bg-gray-800 dark:prose-pre:bg-gray-900"
				: "break-words whitespace-pre-wrap",
			clamp && (markdown ? "max-h-24 overflow-hidden" : "line-clamp-3"),
		]}
		onmouseup={readSelection}
		onkeyup={readSelection}
		use:quoteAnchors={{ quotes, onanchors }}
	>
		{#if markdown}
			<MarkdownRenderer content={value} />
		{:else if structured !== undefined && clamp}
			{jsonSummary(structured)}
		{:else if structured !== undefined && !raw}
			<JsonView value={structured} />
		{:else}
			{value}
		{/if}
	</div>
	{#if pending}
		<span
			class="absolute z-20 flex items-center gap-0.5 rounded-[10px] bg-gray-900 p-1 shadow-[0_6px_20px_rgba(0,0,0,0.18)] dark:bg-gray-100"
			style="left: {pending.x}px; top: {pending.y}px; transform: translate(-50%, {pending.below
				? '6px'
				: 'calc(-100% - 6px)'});"
		>
			<button
				type="button"
				class="flex h-[30px] items-center gap-1.5 rounded-[7px] px-2.5 text-[13px] font-medium whitespace-nowrap text-white hover:bg-white/10 dark:text-gray-900 dark:hover:bg-black/10"
				data-selection-popup
				onmousedown={(e) => e.preventDefault()}
				onclick={comment}
			>
				<CarbonAddComment class="text-xs" />
				Comment
				<kbd class="font-mono text-[10px] opacity-60">C</kbd>
			</button>
		</span>
	{/if}
</div>
