<script lang="ts">
	import type { ReviewSession } from "$lib/stores/mlReview.svelte";
	import {
		canDecide,
		headingField,
		plainText,
		recordDecision,
		shownFields,
	} from "$lib/utils/review/progress";
	import DecisionToggle from "./DecisionToggle.svelte";
	import RecordBody from "./RecordBody.svelte";

	import CarbonChat from "~icons/carbon/chat";

	interface Props {
		session: ReviewSession;
	}

	let { session }: Props = $props();

	let schema = $derived(session.schema);
	let records = $derived(session.records);
	let fields = $derived(schema ? shownFields(schema) : []);
	let heading = $derived(schema ? headingField(schema, records) : undefined);
	let category = $derived(fields.find((field) => field.type === "category"));
	let decidable = $derived(!!schema && canDecide(schema));
	let preview = $derived(
		fields.find(
			(field) =>
				field !== heading &&
				(field.type === "text" ||
					field.type === "markdown" ||
					field.type === "chat" ||
					field.type === "code")
		)
	);

	function toggle(index: number) {
		if (session.expanded.has(index)) session.expanded.delete(index);
		else session.expanded.add(index);
	}
</script>

{#snippet decide(index: number)}
	{#if decidable && schema}
		<DecisionToggle
			decision={recordDecision(schema, session.draft(index))}
			disabled={!session.editable}
			ondecide={(decision) => session.decide([index], decision)}
		/>
	{/if}
{/snippet}

<ul class="m-0 list-none p-0" aria-label="Records" data-list-view>
	{#each records as record, index (index)}
		{@const title = heading ? plainText(record.values[heading.name]) : ""}
		{@const chip = category ? record.values[category.name] : undefined}
		{@const comments = session.draft(index)?.comments.length ?? 0}
		{@const expanded = session.expanded.has(index)}
		<li data-row={index}>
			{#if expanded}
				<div
					class="m-2.5 overflow-hidden rounded-[14px] border border-gray-200 bg-white shadow-[0_2px_10px_rgba(0,0,0,0.06)] dark:border-gray-800 dark:bg-gray-900"
				>
					<div
						class="flex items-center gap-2 border-b border-gray-200 bg-gray-50 pr-3.5 dark:border-gray-800 dark:bg-gray-800/60"
					>
						<button
							type="button"
							class="flex min-w-0 flex-1 items-center gap-3.5 py-3 pl-1.5 text-left"
							aria-expanded="true"
							onclick={() => toggle(index)}
						>
							<span
								class="w-[22px] flex-none text-right font-mono text-xs leading-5 text-gray-500 dark:text-gray-400"
							>
								{index + 1}
							</span>
							<span
								class="min-w-0 flex-1 truncate text-sm font-medium text-gray-900 dark:text-gray-100"
							>
								{title || record.id}
							</span>
							{#if chip !== undefined && chip !== null}
								<span
									class="rounded-[5px] bg-gray-100 px-[7px] py-0.5 text-[11.5px] font-medium whitespace-nowrap text-gray-700 dark:bg-gray-800 dark:text-gray-300"
								>
									{String(chip)}
								</span>
							{/if}
						</button>
						{@render decide(index)}
					</div>
					<div class="flex flex-col gap-3 pt-4 pr-[18px] pb-3.5 pl-[42px]">
						<RecordBody {session} {index} hideHeading={!!heading} />
						{#if session.editable}
							<span class="text-xs text-gray-500 dark:text-gray-400"
								>or select text to comment on it</span
							>
						{/if}
					</div>
				</div>
			{:else}
				<div
					class="flex items-center gap-2 border-b border-gray-200 pr-4 hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-800/40"
				>
					<button
						type="button"
						class="flex min-w-0 flex-1 gap-3.5 py-3.5 pl-4 text-left"
						aria-expanded="false"
						onclick={() => toggle(index)}
					>
						<span
							class="w-[22px] flex-none text-right font-mono text-xs leading-5 text-gray-500 dark:text-gray-400"
						>
							{index + 1}
						</span>
						<span class="flex min-w-0 flex-1 flex-col gap-1">
							<span class="flex min-w-0 items-center gap-2">
								<span
									class="min-w-0 flex-1 truncate text-sm font-medium text-gray-900 dark:text-gray-100"
								>
									{title || record.id}
								</span>
								{#if comments > 0}
									<span
										class="flex items-center gap-[3px] text-xs text-amber-700 dark:text-amber-400"
									>
										<CarbonChat class="text-xs" />{comments}
									</span>
								{/if}
								{#if chip !== undefined && chip !== null}
									<span
										class="rounded-[5px] bg-gray-100 px-[7px] py-0.5 text-[11.5px] font-medium whitespace-nowrap text-gray-700 dark:bg-gray-800 dark:text-gray-300"
									>
										{String(chip)}
									</span>
								{/if}
							</span>
							{#if preview}
								<span
									class="line-clamp-2 text-[13px] leading-normal text-gray-500 dark:text-gray-400"
								>
									{plainText(record.values[preview.name])}
								</span>
							{/if}
						</span>
					</button>
					{@render decide(index)}
				</div>
			{/if}
		</li>
	{/each}
</ul>
