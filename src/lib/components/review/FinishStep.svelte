<script lang="ts">
	import { NOTHING_DECIDED, type ReviewSession } from "$lib/stores/mlReview.svelte";
	import type { ReviewVerdict } from "$lib/types/MlReview";
	import { anchorLabel } from "$lib/utils/review/anchors";
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

	let verdicts = $derived<{ value: ReviewVerdict; label: string; hint: string }[]>(
		labelling
			? [
					{ value: "approve", label: "Approve", hint: "The answers are ready to use." },
					{
						value: "request_changes",
						label: "Request changes",
						hint: "Something in the set or the schema needs redoing first.",
					},
					{
						value: "comment",
						label: "Comment",
						hint: "Send the answers and notes without a decision.",
					},
				]
			: [
					{ value: "approve", label: "Approve", hint: "The data is good to use." },
					{
						value: "request_changes",
						label: "Request changes",
						hint: "Fix what the comments say.",
					},
					{ value: "comment", label: "Comment", hint: "Send the notes without a decision." },
				]
	);

	/** by record, the questions still missing an answer */
	let blocked = $derived.by(() => {
		const byRecord = new Map<number, string[]>();
		for (const blocker of session.blockers) {
			const question = schema?.questions.find((candidate) => candidate.name === blocker.question);
			const names = byRecord.get(blocker.record) ?? [];
			names.push(question?.title ?? blocker.question);
			byRecord.set(blocker.record, names);
		}
		return [...byRecord.entries()].map(([record, questions]) => ({ record, questions }));
	});

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

	/** nothing decided yet, an approve then approves every record and anything else is refused */
	let untouched = $derived(session.decided === 0);
	let approveAll = $derived(untouched && session.chosenVerdict === "approve");

	let reason = $derived.by(() => {
		if (blocked.length === 0 && approveAll) {
			return `Nothing is approved yet, so this approves all ${session.records.length}. You can't edit after sending.`;
		}
		if (blocked.length === 0 && untouched) return NOTHING_DECIDED;
		if (blocked.length === 0) return "You can't edit after sending.";
		const named = blocked.slice(0, 3).map((entry) => `#${entry.record + 1}`);
		const more = blocked.length > 3 ? ` and ${blocked.length - 3} more` : "";
		const list =
			named.length > 1 ? `${named.slice(0, -1).join(", ")} and ${named.at(-1)}` : named[0];
		return `Answer ${list}${more} to send. You can't edit after sending.`;
	});

	async function send() {
		if (await session.submit(session.chosenVerdict, { approveRest: approveAll })) onsubmitted();
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
						<div class="rounded-xl bg-red-50 px-3.5 py-3 dark:bg-red-400/10" data-tile="blocked">
							<div class="text-[22px] font-semibold text-red-600 tabular-nums dark:text-red-400">
								{blocked.length}
							</div>
							<div class="text-[13px] text-red-600 dark:text-red-400">need an answer</div>
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
			<section class="flex flex-col gap-2.5" aria-label="Needs an answer">
				<div class={heading}>
					Needs an answer <span class="font-medium text-gray-500 dark:text-gray-400"
						>{blocked.length}</span
					>
				</div>
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
							<span class="text-xs whitespace-nowrap text-red-600 dark:text-red-400">
								{entry.questions.join(", ")}
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

		<div class="flex flex-col gap-2.5" role="radiogroup" aria-label="Verdict">
			<div class={heading}>Verdict</div>
			{#each verdicts as verdict (verdict.value)}
				{@const on = session.chosenVerdict === verdict.value}
				<label
					class={[
						"flex cursor-pointer items-start gap-3 rounded-xl border px-3.5 py-3",
						on
							? "border-gray-900 shadow-[0_0_0_1px] shadow-gray-900 dark:border-gray-100 dark:shadow-gray-100"
							: "border-gray-200 dark:border-gray-800",
					]}
				>
					<input
						type="radio"
						class="mt-0.5 accent-gray-900 dark:accent-gray-100"
						name="review-verdict-{uid}"
						value={verdict.value}
						checked={on}
						onchange={() => (session.verdict = verdict.value)}
					/>
					<div>
						<div class="text-sm font-semibold text-gray-900 dark:text-gray-100">
							{verdict.label}
						</div>
						<div class="text-[13px] text-gray-500 dark:text-gray-400">{verdict.hint}</div>
					</div>
				</label>
			{/each}
		</div>

		<section class="flex flex-col gap-2">
			<label for="review-note-{uid}" class={heading}>
				Note to the agent <span class="font-medium text-gray-500 dark:text-gray-400">optional</span>
			</label>
			<textarea
				id="review-note-{uid}"
				rows="3"
				bind:value={session.summary}
				maxlength={4000}
				placeholder="Anything the agent should know about these answers"
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
	<div class="flex-1 text-[13px] text-gray-500 dark:text-gray-400" data-send-reason>{reason}</div>
	<button
		type="button"
		class="h-9 rounded-lg bg-gray-900 px-4 text-[13px] font-semibold text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-white"
		disabled={blocked.length > 0 ||
			(untouched && !approveAll) ||
			session.submitting ||
			!session.editable}
		aria-busy={session.submitting}
		onclick={send}
	>
		{session.submitting
			? "Sending…"
			: approveAll
				? `Approve all ${session.records.length} and send`
				: "Send review"}
	</button>
</footer>
