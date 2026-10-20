<script lang="ts">
	import type { ReviewSession } from "$lib/stores/mlReview.svelte";
	import type { ReviewVerdict } from "$lib/types/MlReview";
	import { canDecide, recordDecision } from "$lib/utils/review/progress";

	interface Props {
		session: ReviewSession;
		/** what the footer counts, examples rows or images */
		noun: string;
		onfinish: () => void;
	}

	let { session, noun, onfinish }: Props = $props();

	let noteOpen = $state(false);
	/** every send ends the review, so each one says what it does before it goes */
	let confirming = $state<"approveRest" | "asIs" | undefined>(undefined);
	let schema = $derived(session.schema);
	let total = $derived(session.records.length);
	let decidable = $derived(!!schema && canDecide(schema));
	let tally = $derived.by(() => {
		const counts = { approved: 0, rejected: 0 };
		if (!schema) return counts;
		for (const draft of Object.values(session.drafts)) {
			const decision = recordDecision(schema, draft);
			if (decision) counts[decision] += 1;
		}
		return counts;
	});
	let comments = $derived(session.counts.comments);
	let blocked = $derived(session.blockers.length > 0);
	/** nothing approved, rejected or answered, so the only send is an approve of everything */
	let untouched = $derived(session.decided === 0);
	let left = $derived(session.states.filter((state) => state === "todo").length);
	/** a rejection asks the agent for changes, comments alone are notes on an approval */
	let verdict = $derived<ReviewVerdict>(
		tally.rejected > 0 ? "request_changes" : comments > 0 ? "comment" : "approve"
	);

	const one = (n: number, word: string) => (n === 1 ? word.replace(/s$/, "") : word);

	async function send(approveRest: boolean) {
		confirming = undefined;
		await session.submit(verdict, { approveRest });
	}

	const plain =
		"h-9 rounded-[9px] border border-gray-200 px-3.5 text-[13px] font-semibold whitespace-nowrap text-gray-900 hover:bg-gray-50 disabled:opacity-40 dark:border-gray-700 dark:text-gray-100 dark:hover:bg-gray-800";
	const primary =
		"h-9 rounded-[9px] bg-gray-900 px-3.5 text-[13px] font-semibold whitespace-nowrap text-white hover:bg-gray-800 disabled:opacity-40 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-white";
	const ghost =
		"h-9 rounded-[9px] px-3 text-[13px] font-medium whitespace-nowrap text-gray-500 hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200";
</script>

{#if session.editable}
	{#if noteOpen}
		<div class="flex-none border-t border-gray-200 px-4 pt-3 dark:border-gray-800">
			<textarea
				rows="2"
				bind:value={session.summary}
				maxlength={4000}
				aria-label="Note to the agent"
				placeholder="A note for the agent, sent with your verdict"
				class="scrollbar-custom w-full resize-y rounded-[10px] border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-400 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
			></textarea>
		</div>
	{/if}
	{#if session.submitError}
		<p class="m-0 flex-none px-4 pt-2 text-[13px] text-red-600 dark:text-red-400" role="alert">
			{session.submitError}
		</p>
	{/if}
	<footer
		class="flex flex-none items-center gap-2 border-t border-gray-200 px-4 py-3 dark:border-gray-800"
		data-review-footer
	>
		{#if confirming}
			<div class="min-w-0 flex-1 text-[13px] text-gray-700 dark:text-gray-300" data-footer-status>
				{#if confirming === "asIs"}
					Send with {left}
					{one(left, noun)} not reviewed? This ends the review.
				{:else if untouched}
					Approve all {total}
					{one(total, noun)} and send? This ends the review.
				{:else}
					Approve the {left} remaining {one(left, noun)} and send? This ends the review.
				{/if}
			</div>
			<button type="button" class={ghost} onclick={() => (confirming = undefined)}>Cancel</button>
			<button
				type="button"
				class={primary}
				disabled={session.submitting}
				onclick={() => send(confirming === "approveRest")}
			>
				{confirming === "asIs" ? "Send" : "Approve and send"}
			</button>
		{:else}
			<div
				class="min-w-0 flex-1 truncate text-[13px] text-gray-500 dark:text-gray-400"
				data-footer-status
			>
				{#if decidable}
					<b class="font-semibold text-gray-900 dark:text-gray-100">{tally.approved} approved</b>
					· {tally.rejected} rejected · {left} to review
				{:else}
					<b class="font-semibold text-gray-900 dark:text-gray-100">{session.decided} answered</b>
					· {left} to review
				{/if}
				{#if comments > 0}
					· {comments} comment{comments === 1 ? "" : "s"}
				{/if}
			</div>
			{#if blocked}
				<button type="button" class={primary} onclick={onfinish}>Finish</button>
			{:else}
				<button
					type="button"
					class={ghost}
					aria-expanded={noteOpen}
					onclick={() => (noteOpen = !noteOpen)}
				>
					{noteOpen ? "Hide note" : "Add a note"}
				</button>
				{#if untouched}
					<button
						type="button"
						class={primary}
						disabled={session.submitting}
						onclick={() => (confirming = "approveRest")}
					>
						Approve all {total}…
					</button>
				{:else if left > 0}
					<button
						type="button"
						class={plain}
						disabled={session.submitting}
						onclick={() => (confirming = "asIs")}
					>
						Send now…
					</button>
					<button
						type="button"
						class={primary}
						disabled={session.submitting}
						onclick={() => (confirming = "approveRest")}
					>
						Approve remaining {left}…
					</button>
				{:else}
					<button
						type="button"
						class={primary}
						disabled={session.submitting}
						onclick={() => send(false)}
					>
						Send review
					</button>
				{/if}
			{/if}
		{/if}
	</footer>
{/if}
