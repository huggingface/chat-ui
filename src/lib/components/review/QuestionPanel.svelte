<script lang="ts">
	import type { ReviewSession } from "$lib/stores/mlReview.svelte";
	import type { ReviewQuestion } from "$lib/types/MlReview";
	import QuestionRow from "./QuestionRow.svelte";

	interface Props {
		session: ReviewSession;
		index: number;
		/** a dock under the record, a column beside it, or one question at a time on a phone */
		layout: "dock" | "column" | "phone";
		activeQuestion?: string;
		onactivequestion: (name: string) => void;
		onanswer: (question: ReviewQuestion) => void;
		onskip: () => void;
		onnext: () => void;
		oncomment?: () => void;
		autoAdvance: boolean;
		onautoadvance: (on: boolean) => void;
	}

	let {
		session,
		index,
		layout,
		activeQuestion,
		onactivequestion,
		onanswer,
		onskip,
		onnext,
		oncomment,
		autoAdvance,
		onautoadvance,
	}: Props = $props();

	let schema = $derived(session.schema);
	let questions = $derived(schema?.questions ?? []);
	let record = $derived(session.records[index]);
	let draft = $derived(session.draft(index));
	let editable = $derived(session.editable);
	let current = $derived(
		questions.find((question) => question.name === activeQuestion) ?? questions[0]
	);

	const fieldTitle = (name: string | undefined) => {
		const field = schema?.fields.find((candidate) => candidate.name === name);
		return field ? (field.title ?? field.name) : undefined;
	};

	function answer(question: ReviewQuestion, value: Parameters<ReviewSession["setAnswer"]>[2]) {
		session.setAnswer(index, question.name, value);
		onanswer(question);
	}

	const ghost =
		"inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200";
	const primary =
		"inline-flex h-8 items-center justify-center gap-1.5 rounded-lg bg-gray-900 px-3 text-[13px] font-semibold whitespace-nowrap text-white hover:bg-gray-800 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-white";
</script>

{#snippet row(question: ReviewQuestion, stack: boolean)}
	<QuestionRow
		{question}
		value={draft?.answers[question.name]}
		suggestion={record?.suggestions?.[question.name]}
		mode={schema?.suggestions ?? "none"}
		active={activeQuestion === question.name}
		disabled={!editable}
		layout={stack ? "stack" : "row"}
		about={stack ? fieldTitle(question.target) : undefined}
		onchange={(value) => answer(question, value)}
		onactivate={() => onactivequestion(question.name)}
	/>
{/snippet}

{#snippet autoToggle()}
	<label
		class="flex min-h-8 cursor-pointer items-center gap-1.5 px-2 text-[13px] text-gray-500 dark:text-gray-400"
	>
		<input
			type="checkbox"
			class="m-0 accent-gray-900 dark:accent-gray-100"
			checked={autoAdvance}
			onchange={(e) => onautoadvance(e.currentTarget.checked)}
		/>
		Auto-advance
	</label>
{/snippet}

{#if layout === "dock"}
	<section
		aria-label="Questions"
		class="flex-none border-t border-gray-200 bg-white pt-1.5 dark:border-gray-800 dark:bg-gray-900"
		data-question-dock
	>
		<div class="scrollbar-custom max-h-[45vh] overflow-y-auto">
			{#each questions as question (question.name)}
				{@render row(question, false)}
			{/each}
		</div>
		{#if editable}
			<div
				class="mt-1.5 flex items-center gap-2 border-t border-gray-200 py-2 pr-3 pl-2 dark:border-gray-800"
			>
				<button type="button" class={ghost} onclick={onskip}>
					Skip <kbd class="font-mono text-[11px] text-gray-400">S</kbd>
				</button>
				{@render autoToggle()}
				<span class="flex-1"></span>
				<button type="button" class={primary} onclick={onnext}>
					Next unanswered <kbd class="font-mono text-[11px] opacity-60">↵</kbd>
				</button>
			</div>
		{/if}
	</section>
{:else if layout === "column"}
	<aside
		aria-label="Questions"
		class="flex w-80 flex-none flex-col border-l border-gray-200 dark:border-gray-800"
		data-question-dock
	>
		<div class="scrollbar-custom flex-1 overflow-y-auto">
			{#each questions as question (question.name)}
				{@render row(question, true)}
			{/each}
		</div>
		{#if editable}
			<div class="flex flex-none flex-col gap-2 border-t border-gray-200 p-3 dark:border-gray-800">
				<button type="button" class="{primary} h-9" onclick={onnext}>
					Next unanswered <kbd class="font-mono text-[11px] opacity-60">↵</kbd>
				</button>
				<div class="flex items-center justify-between">
					<button type="button" class={ghost} onclick={onskip}>
						Skip <kbd class="font-mono text-[11px] text-gray-400">S</kbd>
					</button>
					{@render autoToggle()}
				</div>
			</div>
		{/if}
	</aside>
{:else if current}
	{@const position = questions.indexOf(current)}
	<section
		aria-label="Question {position + 1} of {questions.length}"
		class="flex flex-none flex-col gap-3 border-t border-gray-200 bg-white px-4 pt-3 pb-5 shadow-[0_-6px_16px_rgba(0,0,0,0.04)] dark:border-gray-800 dark:bg-gray-900"
		data-question-dock
	>
		<div class="flex items-center justify-between">
			<span class="text-[15px] font-semibold text-gray-900 dark:text-gray-100">
				{current.title ?? current.name}
			</span>
			<span class="flex gap-1">
				{#each questions as question, i (question.name)}
					<button
						type="button"
						tabindex="-1"
						aria-label="Question {i + 1}"
						class={[
							"h-1 w-4 rounded-sm",
							i === position ? "bg-gray-900 dark:bg-gray-100" : "bg-gray-200 dark:bg-gray-700",
						]}
						onclick={() => onactivequestion(question.name)}
					></button>
				{/each}
			</span>
		</div>
		<QuestionRow
			question={current}
			value={draft?.answers[current.name]}
			suggestion={record?.suggestions?.[current.name]}
			mode={schema?.suggestions ?? "none"}
			active
			large
			disabled={!editable}
			layout="stack"
			onchange={(value) => answer(current, value)}
		/>
		{#if editable}
			<div class="flex gap-2">
				<button
					type="button"
					class="h-11 flex-1 rounded-[10px] border border-gray-200 text-[15px] font-semibold text-gray-900 dark:border-gray-700 dark:text-gray-100"
					onclick={onskip}
				>
					Skip
				</button>
				<button
					type="button"
					class="h-11 flex-1 rounded-[10px] border border-gray-200 text-[15px] font-semibold text-gray-900 dark:border-gray-700 dark:text-gray-100"
					onclick={() => oncomment?.()}
				>
					Comment
				</button>
				<button
					type="button"
					class="h-11 flex-[2] rounded-[10px] bg-gray-900 text-[15px] font-semibold text-white dark:bg-gray-100 dark:text-gray-900"
					onclick={() => {
						const next = questions.at(position + 1);
						if (next) onactivequestion(next.name);
						else onnext();
					}}
				>
					Next
				</button>
			</div>
		{/if}
	</section>
{/if}
