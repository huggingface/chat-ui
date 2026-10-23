<script lang="ts">
	import { tick } from "svelte";
	import type {
		ReviewAnswer,
		ReviewQuestion,
		ReviewSuggestion,
		ReviewSuggestionsMode,
	} from "$lib/types/MlReview";
	import { isAnswered, validateAnswer } from "$lib/utils/review/answers";
	import { formatAnswer, keyOptions, pick } from "$lib/utils/review/view";

	import CarbonCheckmark from "~icons/carbon/checkmark";

	interface Props {
		question: ReviewQuestion;
		value: ReviewAnswer | undefined;
		suggestion?: ReviewSuggestion;
		mode: ReviewSuggestionsMode;
		/** the question the number keys answer */
		active?: boolean;
		disabled?: boolean;
		/** a label column beside the answers, or the label above them in a column */
		layout?: "row" | "stack";
		/** names the field a targeted question is about */
		about?: string;
		/** bigger targets for a phone */
		large?: boolean;
		onchange: (value: ReviewAnswer | undefined) => void;
		onactivate?: () => void;
	}

	let {
		question,
		value,
		suggestion,
		mode,
		active = false,
		disabled = false,
		layout = "row",
		about,
		large = false,
		onchange,
		onactivate,
	}: Props = $props();

	let options = $derived(keyOptions(question));
	let answered = $derived(isAnswered(value));
	let problem = $derived(answered ? validateAnswer(question, value) : undefined);
	let agrees = $derived(
		suggestion !== undefined &&
			answered &&
			JSON.stringify(suggestion.value) === JSON.stringify(value)
	);
	/** a golden set hides the guess until answered, a plain review offers it up front */
	let guessBefore = $derived(mode === "shown" && !!suggestion && !answered);
	let guessAfter = $derived(mode !== "none" && !!suggestion && answered);

	let noteOpen = $state(false);
	let noteEl: HTMLTextAreaElement | undefined = $state();
	let showNote = $derived(
		layout === "stack" || noteOpen || (typeof value === "string" && value !== "")
	);

	async function openNote() {
		noteOpen = true;
		await tick();
		noteEl?.focus();
	}

	const selected = (option: ReviewAnswer) =>
		Array.isArray(value) ? value.includes(option as string) : value === option;

	function choose(option: ReviewAnswer) {
		const next = pick(question, value, option);
		if (question.type !== "multi_label" && value === option) onchange(undefined);
		else onchange(Array.isArray(next) && next.length === 0 ? undefined : next);
	}

	const chip = (on: boolean, square: boolean) =>
		[
			"inline-flex items-center justify-center gap-1.5 rounded-lg border font-medium transition-colors disabled:cursor-default",
			large ? "h-11 px-3.5 text-[15px]" : "h-8 text-[13px]",
			square ? (large ? "w-11" : "w-9") : large ? "" : "px-2.5",
			on
				? "border-gray-900 bg-gray-900 text-white dark:border-gray-100 dark:bg-gray-100 dark:text-gray-900"
				: "border-gray-200 bg-white text-gray-700 hover:border-gray-300 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:border-gray-600",
		].join(" ");
</script>

{#snippet guess()}
	{#if guessAfter && suggestion}
		{#if agrees}
			<span
				class="flex items-center gap-1 text-xs whitespace-nowrap text-green-700 dark:text-green-400"
				data-model-note="agrees"
			>
				<CarbonCheckmark class="text-xs" />model agrees
			</span>
		{:else}
			<span
				class="text-xs whitespace-nowrap text-gray-500 dark:text-gray-400"
				data-model-note="differs"
				title={suggestion.rationale}
			>
				model said {formatAnswer(question, suggestion.value)}
			</span>
		{/if}
	{:else if guessBefore && suggestion}
		<button
			type="button"
			class="rounded-md border border-dashed border-gray-300 px-2 py-0.5 text-xs whitespace-nowrap text-gray-500 hover:border-gray-400 hover:text-gray-700 dark:border-gray-600 dark:text-gray-400 dark:hover:text-gray-200"
			title={suggestion.rationale ?? "Accept the model's answer (A)"}
			data-model-note="guess"
			{disabled}
			onclick={() => onchange(suggestion.value)}
		>
			model: {formatAnswer(question, suggestion.value)}{suggestion.score !== undefined
				? ` · ${suggestion.score.toFixed(2)}`
				: ""}
		</button>
	{/if}
{/snippet}

{#snippet answers()}
	{#if question.type === "text"}
		{#if showNote}
			<textarea
				bind:this={noteEl}
				class="scrollbar-custom min-h-16 w-full resize-y rounded-lg border border-gray-200 bg-white px-2.5 py-2 text-[13.5px] leading-normal text-gray-900 outline-none focus:border-blue-400 disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
				aria-label={question.title ?? question.name}
				placeholder="Anything that doesn't fit the options"
				maxlength={question.maxLength}
				{disabled}
				value={typeof value === "string" ? value : ""}
				oninput={(e) => onchange(e.currentTarget.value === "" ? undefined : e.currentTarget.value)}
			></textarea>
		{:else}
			<button
				type="button"
				class="h-8 self-start rounded-lg px-2 text-[13px] font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-800 disabled:opacity-60 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
				{disabled}
				onclick={openNote}
			>
				Add a note
			</button>
		{/if}
	{:else}
		<div
			class="flex flex-wrap items-center gap-1.5"
			role={question.type === "multi_label" ? "group" : "radiogroup"}
			aria-label={question.title ?? question.name}
		>
			{#each options as option, i (String(option.value))}
				<button
					type="button"
					class={chip(selected(option.value), question.type === "rating")}
					role={question.type === "multi_label" ? undefined : "radio"}
					aria-checked={question.type === "multi_label" ? undefined : selected(option.value)}
					aria-pressed={question.type === "multi_label" ? selected(option.value) : undefined}
					{disabled}
					onclick={() => choose(option.value)}
				>
					{#if question.type !== "rating" && i < 9 && !large}
						<kbd class="font-mono text-[10px] opacity-60">{i + 1}</kbd>
					{/if}
					{option.label}
				</button>
			{/each}
		</div>
	{/if}
	{#if problem}
		<p class="text-xs text-red-600 dark:text-red-400">{problem}</p>
	{/if}
{/snippet}

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
{#if layout === "row"}
	<div
		class={[
			"flex min-h-11 items-center gap-3 px-4 py-1.5",
			active && "bg-gray-50 dark:bg-gray-800/60",
		]}
		data-question={question.name}
		data-active={active || undefined}
		onclick={onactivate}
	>
		<div
			class={[
				"w-[116px] flex-none text-[13px] leading-tight",
				question.required
					? "font-semibold text-gray-900 dark:text-gray-100"
					: "font-medium text-gray-700 dark:text-gray-300",
			]}
			title={question.description}
		>
			{question.title ?? question.name}
		</div>
		<div class="flex min-w-0 flex-1 flex-col gap-1">{@render answers()}</div>
		{@render guess()}
	</div>
{:else}
	<div
		class={[
			"flex flex-col gap-2 border-b border-gray-200 px-4 py-3.5 dark:border-gray-800",
			active && "bg-gray-50 dark:bg-gray-800/60",
		]}
		data-question={question.name}
		data-active={active || undefined}
		onclick={onactivate}
	>
		<div class="flex items-center gap-2 text-[13px] font-semibold text-gray-900 dark:text-gray-100">
			<span title={question.description}>{question.title ?? question.name}</span>
			{#if !question.required}
				<span class="font-normal text-gray-500 dark:text-gray-400">optional</span>
			{/if}
			<span class="flex-1"></span>
			{@render guess()}
		</div>
		{#if about}
			<div class="text-xs text-blue-600 dark:text-blue-400">About {about}</div>
		{/if}
		{@render answers()}
	</div>
{/if}
