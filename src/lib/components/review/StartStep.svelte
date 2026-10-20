<script lang="ts">
	import MarkdownRenderer from "$lib/components/chat/MarkdownRenderer.svelte";
	import type { ReviewSession } from "$lib/stores/mlReview.svelte";
	import { keyRange, questionSummary } from "$lib/utils/review/progress";

	import CarbonArrowRight from "~icons/carbon/arrow-right";

	interface Props {
		session: ReviewSession;
		onstart: (index: number) => void;
		onbrowse: () => void;
	}

	let { session, onstart, onbrowse }: Props = $props();

	let schema = $derived(session.schema);
	let records = $derived(session.records);
	let firstTodo = $derived(Math.max(0, session.states.indexOf("todo")));
	let started = $derived(session.states.some((state) => state !== "todo"));
	let guesses = $derived(records.some((record) => record.suggestions));
	let noun = $derived(records.length === 1 ? "record" : "records");
</script>

{#if schema}
	<main
		class="scrollbar-custom flex flex-1 justify-center overflow-y-auto px-8 pt-12 pb-8"
		data-start-step
	>
		<div class="flex w-full max-w-[540px] flex-col gap-8">
			<div class="flex flex-col gap-3">
				<div class="text-[13px] text-gray-500 dark:text-gray-400">
					ML Intern asks you to {session.labelling ? "label" : "review"}
					{records.length}
					{noun}
				</div>
				<h1
					class="m-0 text-[26px] leading-tight font-semibold tracking-[-0.01em] text-gray-900 dark:text-gray-100"
				>
					{schema.title}
				</h1>
				{#if schema.instructions}
					<div
						class="prose max-w-none text-[15px] leading-[1.65] text-gray-700 dark:text-gray-300 dark:prose-invert"
					>
						<MarkdownRenderer content={schema.instructions} />
					</div>
				{/if}
			</div>

			{#if schema.questions.length > 0}
				<div class="flex flex-col gap-2.5">
					<div class="text-xs font-semibold text-gray-500 dark:text-gray-400">For each record</div>
					<div class="flex flex-col rounded-xl border border-gray-200 dark:border-gray-800">
						{#each schema.questions as question, i (question.name)}
							{@const keys = keyRange(question)}
							<div
								class={[
									"flex items-center gap-3 px-3.5 py-3",
									i < schema.questions.length - 1 &&
										"border-b border-gray-200 dark:border-gray-800",
								]}
							>
								<div class="flex-1 text-sm font-medium text-gray-900 dark:text-gray-100">
									{question.title ?? question.name}
									{#if !question.required}
										<span class="font-normal text-gray-500 dark:text-gray-400">optional</span>
									{/if}
								</div>
								<div class="min-w-0 truncate text-[13px] text-gray-500 dark:text-gray-400">
									{questionSummary(question)}
								</div>
								{#if keys}
									<kbd
										class="rounded border border-gray-200 bg-gray-50 px-[5px] py-[3px] font-mono text-[11px] leading-none text-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400"
									>
										{keys}
									</kbd>
								{/if}
							</div>
						{/each}
					</div>
					{#if guesses && schema.suggestions === "after_answer"}
						<div class="text-[13px] leading-normal text-gray-500 dark:text-gray-400">
							The model has guessed answers. Its guess appears only after you answer, so it can't
							steer you.
						</div>
					{:else if guesses && schema.suggestions === "shown"}
						<div class="text-[13px] leading-normal text-gray-500 dark:text-gray-400">
							The model's guesses show beside each question. Press A to accept one.
						</div>
					{/if}
				</div>
			{/if}

			<div class="flex flex-col gap-3.5">
				<div class="flex items-center gap-2.5">
					<button
						type="button"
						class="inline-flex h-10 items-center gap-2 rounded-[10px] bg-gray-900 px-4 text-sm font-semibold text-white hover:bg-gray-800 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-white"
						onclick={() => onstart(firstTodo)}
					>
						{started ? `Continue at #${firstTodo + 1}` : "Start at #1"}
						<CarbonArrowRight class="text-sm" />
					</button>
					<button
						type="button"
						class="inline-flex h-10 items-center rounded-[10px] border border-gray-200 px-4 text-sm font-semibold text-gray-900 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-100 dark:hover:bg-gray-800"
						onclick={onbrowse}
					>
						Browse the list
					</button>
				</div>
				<div class="text-[13px] text-gray-500 dark:text-gray-400">
					Answers save as you go. These instructions stay under the title while you work.
				</div>
			</div>
		</div>
	</main>
{/if}
