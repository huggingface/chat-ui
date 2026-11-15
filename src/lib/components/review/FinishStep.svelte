<script lang="ts">
	import type { ReviewSession } from "$lib/stores/mlReview.svelte";
	import { anchorLabel } from "$lib/utils/review/anchors";
	import PushStatus from "./PushStatus.svelte";
	import { headingField, plainText } from "$lib/utils/review/progress";

	import CarbonWarning from "~icons/carbon/warning-alt";

	interface Props {
		session: ReviewSession;
		onsubmitted: () => void;
	}

	let { session, onsubmitted }: Props = $props();

	const uid = $props.id();
	const SHOWN_COMMENTS = 5;
	const SHOWN_BLOCKED = 10;

	let schema = $derived(session.schema);
	let records = $derived(session.records);
	let labelling = $derived((schema?.questions.length ?? 0) > 0);
	let showAll = $state(false);
	let showAllBlocked = $state(false);
	let titleField = $derived(schema ? headingField(schema, records) : undefined);
	const titleOf = (index: number) => {
		const record = records[index];
		const title = titleField && record ? plainText(record.values[titleField.name]) : "";
		return title || record?.id || "";
	};

	/** by record, the questions still missing an answer or holding one that is not valid */
	let blocked = $derived.by(() => {
		const byRecord = new Map<number, { questions: string[]; invalid: boolean }>();
		for (const blocker of session.blockers) {
			const question = schema?.questions.find((candidate) => candidate.name === blocker.question);
			const entry = byRecord.get(blocker.record) ?? { questions: [], invalid: false };
			entry.questions.push(question?.title ?? blocker.question);
			if (blocker.reason !== "required") entry.invalid = true;
			byRecord.set(blocker.record, entry);
		}
		return [...byRecord.entries()].map(([record, entry]) => ({ record, ...entry }));
	});
	let invalid = $derived(blocked.filter((entry) => entry.invalid));
	let confirmPartial = $state(false);

	let comments = $derived(
		Object.entries(session.drafts)
			.flatMap(([key, draft]) => draft.comments.map((comment) => ({ index: Number(key), comment })))
			.sort((a, b) => a.index - b.index)
	);

	let commented = $derived(new Set(comments.map((entry) => entry.index)).size);

	const fieldTitle = (name: string | undefined) => {
		const field = schema?.fields.find((candidate) => candidate.name === name);
		return field?.title ?? name;
	};

	/** nothing answered, marked or commented and no note, worth one question before it goes */
	let empty = $derived(
		session.decided === 0 && session.counts.comments === 0 && !session.note.trim()
	);
	let confirmEmpty = $state(false);

	let reason = $derived.by(() => {
		if (invalid.length > 0) {
			const named = invalid.slice(0, 3).map((entry) => `#${entry.record + 1}`);
			const more = invalid.length > 3 ? ` and ${invalid.length - 3} more` : "";
			const list =
				named.length > 1 ? `${named.slice(0, -1).join(", ")} and ${named.at(-1)}` : named[0];
			return `Fix the answers on ${list}${more} to send.`;
		}
		if (confirmEmpty && empty) return "Send without any notes? You can't edit after sending.";
		if (confirmPartial && session.unfinished > 0) {
			return `${session.unfinished} of ${records.length} records aren't finished. Send anyway? They go to the agent as not reviewed.`;
		}
		return "You can't edit after sending.";
	});

	async function send() {
		if (empty && !confirmEmpty) {
			confirmEmpty = true;
			return;
		}
		if (session.unfinished > 0 && !confirmPartial) {
			confirmPartial = true;
			return;
		}
		if (await session.submit()) onsubmitted();
	}

	const tile = "rounded-xl bg-gray-50 px-3.5 py-3 dark:bg-gray-800/60";
	const tileNumber = "text-[22px] font-semibold tabular-nums text-gray-900 dark:text-gray-100";
	const tileLabel = "text-[13px] text-gray-500 dark:text-gray-400";
	const heading =
		"flex items-center gap-2 text-[13px] font-semibold text-gray-900 dark:text-gray-100";
</script>

<main
	class="scrollbar-custom flex flex-1 justify-center overflow-y-auto px-8 pt-8 pb-6"
	data-finish-step
>
	<div class="flex w-full max-w-[560px] flex-col gap-7">
		<div class="flex flex-col gap-3.5">
			<h1 class="m-0 text-2xl font-semibold tracking-[-0.01em] text-gray-900 dark:text-gray-100">
				Finish and send
			</h1>
			<div class="grid grid-cols-3 gap-2.5">
				{#if labelling}
					<div class={tile}>
						<div class={tileNumber}>{session.counts.answered}</div>
						<div class={tileLabel}>answered</div>
					</div>
					<div class={tile}>
						<div class={tileNumber}>{session.counts.skipped}</div>
						<div class={tileLabel}>skipped</div>
					</div>
					{#if blocked.length > 0}
						<div
							class="rounded-xl bg-amber-50 px-3.5 py-3 dark:bg-amber-400/10"
							data-tile="unfinished"
						>
							<div
								class="text-[22px] font-semibold text-amber-700 tabular-nums dark:text-amber-400"
							>
								{blocked.length}
							</div>
							<div class="text-[13px] text-amber-700 dark:text-amber-400">not finished</div>
						</div>
					{:else}
						<div class={tile}>
							<div class={tileNumber}>{session.counts.comments}</div>
							<div class={tileLabel}>comments</div>
						</div>
					{/if}
				{:else}
					<div class={tile}>
						<div class={tileNumber}>{records.length}</div>
						<div class={tileLabel}>records</div>
					</div>
					<div class={tile}>
						<div class={tileNumber}>{commented}</div>
						<div class={tileLabel}>commented</div>
					</div>
					<div class={tile}>
						<div class={tileNumber}>{session.counts.comments}</div>
						<div class={tileLabel}>comments</div>
					</div>
				{/if}
			</div>
		</div>

		{#if blocked.length > 0}
			<section class="flex flex-col gap-2.5" aria-label="Not finished">
				<div class={heading}>
					Not finished <span class="font-medium text-gray-500 dark:text-gray-400"
						>{blocked.length}</span
					>
				</div>
				<p class="m-0 text-[13px] text-gray-500 dark:text-gray-400">
					You can still send. These go to the agent as not reviewed.
				</p>
				<div
					class="flex flex-col overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800"
				>
					{#each showAllBlocked ? blocked : blocked.slice(0, SHOWN_BLOCKED) as entry (entry.record)}
						<div
							class="flex items-center gap-3 border-b border-gray-200 py-2.5 pr-3 pl-3.5 text-[13.5px] last:border-b-0 dark:border-gray-800"
							data-blocker={entry.record}
						>
							<span class="flex-none font-mono text-xs text-gray-500 dark:text-gray-400">
								#{entry.record + 1}
							</span>
							<span class="min-w-0 flex-1 truncate text-gray-700 dark:text-gray-300">
								{titleOf(entry.record)}
							</span>
							<span
								class={[
									"text-xs whitespace-nowrap",
									entry.invalid
										? "text-red-600 dark:text-red-400"
										: "text-amber-700 dark:text-amber-400",
								]}
							>
								{entry.invalid ? "fix " : ""}{entry.questions.join(", ")}
							</span>
							<button
								type="button"
								class="h-7 rounded-lg border border-gray-200 px-3 text-[13px] font-semibold text-gray-900 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-100 dark:hover:bg-gray-800"
								onclick={() => session.openRecord(entry.record)}
							>
								Go
							</button>
						</div>
					{/each}
					{#if blocked.length > SHOWN_BLOCKED}
						<button
							type="button"
							class="px-3.5 py-2.5 text-left text-[13px] text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"
							onclick={() => (showAllBlocked = !showAllBlocked)}
						>
							{showAllBlocked ? "Show fewer" : `Show all ${blocked.length}`}
						</button>
					{/if}
				</div>
			</section>
		{/if}

		<section class="flex flex-col gap-2.5" aria-label="Your comments">
			<div class={heading}>
				Your comments <span class="font-medium text-gray-500 dark:text-gray-400"
					>{comments.length}</span
				>
				<span class="flex-1"></span>
				{#if comments.length > 0}
					<span class="text-xs font-normal text-gray-500 dark:text-gray-400"
						>All go to the agent</span
					>
				{/if}
			</div>
			{#if comments.length === 0}
				<p class="m-0 text-[13px] text-gray-500 dark:text-gray-400">No comments.</p>
			{:else}
				<div
					class="flex flex-col overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800"
				>
					{#each showAll ? comments : comments.slice(0, SHOWN_COMMENTS) as { index, comment } (comment.id)}
						<button
							type="button"
							class="flex items-start gap-3 border-b border-gray-200 py-2.5 pr-3 pl-3.5 text-left text-[13.5px] hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-800/60"
							onclick={() => session.openRecord(index)}
						>
							<span class="mt-[3px] flex-none font-mono text-xs text-gray-500 dark:text-gray-400">
								#{index + 1}
							</span>
							<span class="flex min-w-0 flex-1 flex-col gap-[3px]">
								<span class="text-xs text-gray-500 dark:text-gray-400">
									{#if comment.quote}
										on “{comment.quote.exact}”
									{:else if anchorLabel(comment)}
										on {fieldTitle(comment.field)} at {anchorLabel(comment)}
									{:else if comment.field}
										on {fieldTitle(comment.field)}
									{:else}
										on the record
									{/if}
								</span>
								<span class="break-words text-gray-700 dark:text-gray-300">{comment.body}</span>
							</span>
						</button>
					{/each}
					{#if comments.length > SHOWN_COMMENTS}
						<button
							type="button"
							class="px-3.5 py-2.5 text-left text-[13px] text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"
							onclick={() => (showAll = !showAll)}
						>
							{showAll ? "Show fewer" : `Show all ${comments.length}`}
						</button>
					{/if}
				</div>
			{/if}
		</section>

		<section class="flex flex-col gap-2">
			<label for="review-note-{uid}" class={heading}>
				Note to the agent <span class="font-medium text-gray-500 dark:text-gray-400">optional</span>
			</label>
			<textarea
				id="review-note-{uid}"
				rows="3"
				bind:value={session.note}
				maxlength={4000}
				placeholder="Anything the agent should know, or what to do next"
				class="scrollbar-custom resize-y rounded-[10px] border border-gray-200 bg-white px-3 py-2.5 text-sm leading-normal text-gray-900 outline-none focus:border-blue-400 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
			></textarea>
		</section>
	</div>
</main>

{#if session.submitError}
	<div
		class="flex flex-none items-center gap-3 bg-red-50 px-4 py-3 dark:bg-red-400/10"
		role="alert"
	>
		<CarbonWarning class="flex-none text-red-600 dark:text-red-400" />
		<div class="flex-1 text-[13px] text-gray-700 dark:text-gray-300">
			Couldn't send: <span class="text-red-600 dark:text-red-400">{session.submitError}</span>
		</div>
		<button
			type="button"
			class="h-9 rounded-lg border border-gray-200 px-3.5 text-[13px] font-semibold text-gray-900 hover:bg-white dark:border-gray-700 dark:text-gray-100 dark:hover:bg-gray-800"
			onclick={() => session.refresh()}
		>
			Reload
		</button>
	</div>
{/if}
<footer
	class="flex flex-none items-center gap-3 border-t border-gray-200 px-4 py-3 dark:border-gray-800"
>
	<div class="flex min-w-0 flex-1 flex-col gap-1">
		<div class="text-[13px] text-gray-500 dark:text-gray-400" data-send-reason>{reason}</div>
		<PushStatus
			destination={session.payload?.destination}
			audience={session.payload?.publish?.audience}
			planned
		/>
	</div>
	<button
		type="button"
		class="h-9 rounded-lg bg-gray-900 px-4 text-[13px] font-semibold text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-white"
		disabled={invalid.length > 0 || session.submitting || !session.editable}
		aria-busy={session.submitting}
		onclick={send}
	>
		{session.submitting
			? "Sending…"
			: (confirmEmpty && empty) || (confirmPartial && session.unfinished > 0)
				? "Send anyway"
				: "Send"}
	</button>
</footer>
