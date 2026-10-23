<script lang="ts">
	import { untrack } from "svelte";
	import { mlReviews } from "$lib/stores/mlReview.svelte";
	import { sidePane } from "$lib/stores/sidePane.svelte";
	import type {
		MessageReviewRequestUpdate,
		MessageReviewResolvedUpdate,
	} from "$lib/types/MessageUpdate";
	import { formatFileRef } from "$lib/utils/mlRegistry";
	import { deliveryLabel } from "$lib/utils/review/view";
	import PushStatus from "../review/PushStatus.svelte";

	import CarbonArrowRight from "~icons/carbon/arrow-right";
	import CarbonCheckmarkOutline from "~icons/carbon/checkmark-outline";
	import CarbonDocument from "~icons/carbon/document";
	import CarbonInformation from "~icons/carbon/information";
	import CarbonTaskComplete from "~icons/carbon/task-complete";
	import CarbonTime from "~icons/carbon/time";
	import CarbonView from "~icons/carbon/view";
	import CarbonWarning from "~icons/carbon/warning-alt";

	interface Props {
		request: MessageReviewRequestUpdate;
		resolved?: MessageReviewResolvedUpdate;
		conversationId: string;
		/** false on a share, which shows the submitted summary and nothing else */
		interactive: boolean;
	}

	let { request, resolved, conversationId, interactive }: Props = $props();

	$effect(() => {
		if (interactive && conversationId && !resolved) {
			const reviewId = request.reviewId;
			// a store reset must not re-run this, a card still mounted would re-bind the old conversation
			untrack(() => mlReviews.ensure(conversationId, reviewId));
		}
	});

	let session = $derived(interactive ? mlReviews.get(request.reviewId) : undefined);
	let payload = $derived(session?.payload);
	let status = $derived(resolved ? "submitted" : payload?.status);
	let label = $derived(request.mode === "label");
	let kind = $derived(label ? "Labelling task" : "Review request");
	let confirming = $state(false);

	let frozen = $derived.by(() => {
		if (resolved) {
			return {
				answered: resolved.answered,
				skipped: resolved.skipped,
				comments: resolved.comments,
				files: resolved.files,
			};
		}
		if (payload?.status !== "submitted" || !session) return undefined;
		return {
			answered: session.counts.answered,
			skipped: session.counts.skipped,
			comments: session.counts.comments,
			files: payload.result?.files ?? [],
		};
	});

	let counts = $derived(session?.counts ?? { answered: 0, skipped: 0, comments: 0 });
	let firstTodo = $derived(Math.max(0, session?.states.indexOf("todo") ?? 0));
	let started = $derived(counts.answered + counts.skipped + counts.comments > 0);
	let ready = $derived(
		label &&
			!!session &&
			session.unfinished === 0 &&
			session.invalidBlockers.length === 0 &&
			counts.answered > 0
	);
	let commentedRecords = $derived(
		Object.values(session?.drafts ?? {}).filter((draft) => draft.comments.length > 0).length
	);

	let subtitle = $derived.by(() => {
		const schema = payload?.schema;
		if (!schema) return undefined;
		if (schema.questions.length === 0) {
			return "Skim them and comment on anything off. No questions to answer.";
		}
		const required = schema.questions.filter((question) => question.required).length;
		const parts = [
			`${schema.questions.length} question${schema.questions.length === 1 ? "" : "s"} each${required ? `, ${required} required` : ""}`,
		];
		const guesses = payload.records.some((record) => record.suggestions);
		if (guesses && schema.suggestions === "after_answer") {
			parts.push("the model's guesses stay hidden until you answer");
		} else if (guesses && schema.suggestions === "shown") {
			parts.push("the model's guesses show beside each question");
		}
		return parts.join(" · ");
	});

	const pct = (n: number) => `${Math.min(100, (n / Math.max(request.records, 1)) * 100)}%`;

	function open(screen?: "finish") {
		sidePane.openReview(request.reviewId);
		if (session && screen) session.screen = screen;
	}

	function continueAt(index: number) {
		sidePane.openReview(request.reviewId);
		session?.openRecord(index);
	}

	async function markAllOk() {
		confirming = false;
		await session?.submit({ approveRest: true });
	}

	const card =
		"my-2 flex w-full max-w-[450px] flex-col gap-3 rounded-[14px] border border-gray-200 bg-white p-4 has-[+.prose]:mb-4! [.prose+&]:mt-4! dark:border-gray-800 dark:bg-gray-900";
	const row =
		"my-2 flex w-full max-w-[450px] items-center gap-2.5 rounded-[14px] border border-gray-200 bg-white px-4 py-3 has-[+.prose]:mb-4! [.prose+&]:mt-4! dark:border-gray-800 dark:bg-gray-900";
	const tile =
		"flex size-7 flex-none items-center justify-center rounded-lg bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300";
	const pill = "rounded-full px-2 py-[5px] text-xs leading-none font-medium whitespace-nowrap";
	const primary =
		"inline-flex h-9 items-center gap-1.5 rounded-[9px] bg-gray-900 px-3.5 text-[13px] font-semibold text-white hover:bg-gray-800 disabled:opacity-50 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-white";
	const plain =
		"inline-flex h-9 items-center gap-1.5 rounded-[9px] border border-gray-200 bg-white px-3.5 text-[13px] font-semibold text-gray-900 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800";
</script>

{#snippet header(pillText: string, pillClass: string)}
	<div class="flex items-center gap-2.5">
		<div class={tile}>
			{#if label}<CarbonTaskComplete class="text-base" />{:else}<CarbonView
					class="text-base"
				/>{/if}
		</div>
		<div class="flex-1 text-[13px] text-gray-500 dark:text-gray-400">{kind}</div>
		<span class="{pill} {pillClass}" data-card-pill>{pillText}</span>
	</div>
{/snippet}

{#snippet bar()}
	<div class="flex h-1.5 gap-px overflow-hidden rounded-[3px] bg-gray-100 dark:bg-gray-800">
		<div class="bg-green-600 dark:bg-green-500" style="width: {pct(counts.answered)}"></div>
		<div class="bg-amber-500" style="width: {pct(counts.skipped)}"></div>
	</div>
{/snippet}

{#snippet tally(answeredOnly: boolean)}
	<div
		class="flex flex-wrap gap-x-3.5 text-[13px] text-gray-500 dark:text-gray-400"
		data-card-tally
	>
		<span>
			<b class="font-semibold text-gray-900 dark:text-gray-100">{counts.answered}</b>
			{answeredOnly ? "answered" : `of ${request.records} answered`}
		</span>
		{#if counts.skipped > 0}<span>{counts.skipped} skipped</span>{/if}
		{#if counts.comments > 0}
			<span>{counts.comments} comment{counts.comments === 1 ? "" : "s"}</span>
		{/if}
	</div>
{/snippet}

{#if frozen}
	{#if !interactive}
		<div class={row} data-exclude-from-copy role="group" aria-label="Review: {request.title}">
			<div class="{tile} bg-green-50 text-green-700 dark:bg-green-400/10 dark:text-green-400">
				<CarbonCheckmarkOutline class="text-base" />
			</div>
			<div class="min-w-0 flex-1 text-[13px] text-gray-500 dark:text-gray-400">
				<span class="font-medium text-gray-700 dark:text-gray-300">{request.title}</span>
				· sent · {frozen.comments} comment{frozen.comments === 1 ? "" : "s"}
			</div>
		</div>
	{:else}
		<div class={card} data-exclude-from-copy role="group" aria-label="Review: {request.title}">
			<div class="flex items-center gap-2.5">
				<div class="{tile} bg-green-50 text-green-700 dark:bg-green-400/10 dark:text-green-400">
					<CarbonCheckmarkOutline class="text-base" />
				</div>
				<div class="flex-1 text-[13px] text-gray-500 dark:text-gray-400">{kind} · submitted</div>
				<span
					class="{pill} bg-green-50 text-green-700 dark:bg-green-400/10 dark:text-green-400"
					data-card-pill
				>
					Sent
				</span>
			</div>
			<div class="flex flex-col gap-1">
				<div class="text-base font-semibold text-gray-900 dark:text-gray-100">{request.title}</div>
				<div class="text-[13px] text-gray-500 dark:text-gray-400" data-card-tally>
					{#if label}
						{frozen.answered} of {request.records} answered{frozen.skipped
							? ` · ${frozen.skipped} skipped`
							: ""} · {frozen.comments} comment{frozen.comments === 1 ? "" : "s"}
					{:else}
						{frozen.answered} of {request.records} marked OK{frozen.skipped
							? ` · ${frozen.skipped} rejected or skipped`
							: ""} · {frozen.comments} comment{frozen.comments === 1 ? "" : "s"}{commentedRecords
							? ` on ${commentedRecords}`
							: ""}
					{/if}
				</div>
			</div>
			{#if payload?.note}
				<div
					class="rounded-[10px] bg-gray-50 px-3 py-2.5 text-[13px] leading-normal text-gray-700 dark:bg-gray-800/60 dark:text-gray-300"
				>
					“{payload.note}”
				</div>
			{/if}
			{#if payload?.delivery}
				<p
					class={[
						"m-0 text-xs",
						payload.delivery.status === "failed"
							? "text-red-600 dark:text-red-400"
							: "text-gray-500 dark:text-gray-400",
					]}
					data-delivery={payload.delivery.status}
				>
					{deliveryLabel(payload.delivery.status)}
				</p>
			{/if}
			<PushStatus
				destination={payload?.destination}
				push={payload?.push}
				stale={session?.pushStale}
				detached={!!payload?.delivery}
				publish={payload?.publish}
				pushed={resolved?.pushed}
				failed={resolved?.pushFailed}
				declined={payload?.declinedDestination}
			/>
			<div class="flex flex-wrap items-center gap-2">
				{#each frozen.files as file (`${file.name}@${file.version}`)}
					<button
						type="button"
						class="{plain} font-medium"
						title="Show in Resources"
						onclick={() => sidePane.openRegistry(file)}
					>
						<CarbonDocument class="flex-none text-sm" />
						<span class="max-w-[240px] truncate">{formatFileRef(file)}</span>
					</button>
				{/each}
				<button
					type="button"
					class="inline-flex h-9 items-center rounded-[9px] px-3 text-[13px] font-semibold text-gray-500 hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100"
					onclick={() => open()}
				>
					View answers
				</button>
			</div>
		</div>
	{/if}
{:else if !interactive}
	<div class={row} data-exclude-from-copy role="group" aria-label="Review: {request.title}">
		<div class={tile}>
			{#if label}<CarbonTaskComplete class="text-base" />{:else}<CarbonView
					class="text-base"
				/>{/if}
		</div>
		<div class="min-w-0 flex-1 text-[13px] text-gray-500 dark:text-gray-400">
			<span class="font-medium text-gray-700 dark:text-gray-300">{request.title}</span> · not submitted
		</div>
	</div>
{:else if !session || session.load === "loading"}
	<div class={card} aria-busy="true" aria-label="Review: {request.title}" data-exclude-from-copy>
		<div class="flex items-center gap-2.5">
			<div class="size-7 rounded-lg bg-gray-100 dark:bg-gray-800"></div>
			<div class="h-3 w-24 rounded-md bg-gray-100 dark:bg-gray-800"></div>
		</div>
		<div class="h-4 w-60 rounded-md bg-gray-100 dark:bg-gray-800"></div>
		<div class="h-1.5 w-full rounded-[3px] bg-gray-100 dark:bg-gray-800"></div>
	</div>
{:else if session.load === "missing"}
	<div class={row} data-exclude-from-copy role="group" aria-label="Review: {request.title}">
		<CarbonInformation class="flex-none text-gray-500" />
		<div class="flex-1 text-[13px] text-gray-500 dark:text-gray-400">
			This review is no longer available.
		</div>
	</div>
{:else if session.load === "error"}
	<div
		class="{row} py-2 pr-2"
		data-exclude-from-copy
		role="group"
		aria-label="Review: {request.title}"
	>
		<CarbonWarning class="flex-none text-red-600 dark:text-red-400" />
		<div class="flex-1 text-[13px] text-gray-700 dark:text-gray-300">Couldn't load the review.</div>
		<button type="button" class="{plain} h-8" onclick={() => session?.refresh()}>Retry</button>
	</div>
{:else if status === "expired"}
	<div class={row} data-exclude-from-copy role="group" aria-label="Review: {request.title}">
		<CarbonTime class="flex-none text-gray-500" />
		<div class="min-w-0 flex-1 text-[13px] text-gray-500 dark:text-gray-400">
			<span class="font-medium text-gray-700 dark:text-gray-300">{request.title}</span> · expired before
			it was submitted
		</div>
	</div>
{:else if status === "detached"}
	<div class={card} data-exclude-from-copy role="group" aria-label="Review: {request.title}">
		{@render header("Still open", "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300")}
		<div class="text-base font-semibold text-gray-900 dark:text-gray-100">{request.title}</div>
		{#if label}
			<div class="flex flex-col gap-2">
				{@render bar()}
				{@render tally(false)}
			</div>
		{/if}
		<div class="text-[13px] leading-normal text-gray-700 dark:text-gray-300">
			The conversation moved on. You can still finish; your submission arrives as a new message.
		</div>
		<div class="flex gap-2">
			<button type="button" class={plain} onclick={() => continueAt(firstTodo)}>
				{label ? `Continue at #${firstTodo + 1}` : "Open review"}
			</button>
		</div>
	</div>
{:else}
	<div class={card} data-exclude-from-copy role="group" aria-label="Review: {request.title}">
		{#if ready}
			{@render header(
				"Ready to submit",
				"bg-green-50 text-green-700 dark:bg-green-400/10 dark:text-green-400"
			)}
		{:else}
			{@render header(
				"Waiting for you",
				"bg-blue-50 text-blue-600 dark:bg-blue-400/[0.14] dark:text-blue-400"
			)}
		{/if}
		<div class="flex flex-col gap-1">
			<div class="text-base font-semibold text-gray-900 dark:text-gray-100">{request.title}</div>
			{#if subtitle && !(label && started)}
				<div class="text-[13px] leading-normal text-gray-500 dark:text-gray-400">{subtitle}</div>
			{/if}
		</div>

		{#if label && started}
			<div class="flex flex-col gap-2">
				{@render bar()}
				{@render tally(ready)}
			</div>
		{:else if !label && counts.comments > 0}
			<div class="text-[13px] text-gray-500 dark:text-gray-400">
				{counts.comments} comment{counts.comments === 1 ? "" : "s"} on {commentedRecords} of {request.records}
			</div>
		{/if}

		{#if session.submitError}
			<p class="m-0 text-xs text-red-600 dark:text-red-400" role="alert">{session.submitError}</p>
		{/if}

		{#if confirming}
			<div
				class="flex flex-wrap items-center gap-2 rounded-[10px] bg-gray-50 py-2.5 pr-2.5 pl-3.5 dark:bg-gray-800/60"
				data-approve-all-confirm
			>
				<div
					class="flex min-w-0 flex-1 flex-col gap-1 text-[13px] leading-snug text-gray-700 dark:text-gray-300"
				>
					Mark all {request.records} OK without opening any? This sends the review.
					<PushStatus
						destination={payload?.destination}
						audience={payload?.publish?.audience}
						planned
					/>
				</div>
				<button
					type="button"
					class="h-8 rounded-lg px-3 text-[13px] font-semibold text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
					onclick={() => (confirming = false)}
				>
					Cancel
				</button>
				<button
					type="button"
					class="{primary} h-8"
					disabled={session.submitting}
					onclick={markAllOk}
				>
					Mark OK and send
				</button>
			</div>
		{:else}
			<div class="flex flex-wrap items-center gap-2">
				{#if label}
					{#if ready}
						<button type="button" class={primary} onclick={() => open("finish")}>
							Review and submit
						</button>
						<button type="button" class={plain} onclick={() => open()}>Open</button>
					{:else if started}
						<button type="button" class={primary} onclick={() => continueAt(firstTodo)}>
							Continue at #{firstTodo + 1}<CarbonArrowRight class="text-sm" />
						</button>
						<span class="text-xs text-gray-500 dark:text-gray-400">Saved as you go</span>
					{:else}
						<button type="button" class={primary} onclick={() => open()}>
							Start labelling<CarbonArrowRight class="text-sm" />
						</button>
					{/if}
				{:else}
					<button type="button" class={primary} onclick={() => open()}>Open review</button>
					{#if session.editable}
						<button type="button" class={plain} onclick={() => (confirming = true)}>
							Mark all {request.records} OK
						</button>
					{/if}
				{/if}
			</div>
		{/if}
	</div>
{/if}
