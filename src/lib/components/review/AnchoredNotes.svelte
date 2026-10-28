<script lang="ts">
	import type { ReviewComment, ReviewTime } from "$lib/types/MlReview";
	import { formatArea, formatTime, pinNumbers } from "$lib/utils/review/anchors";

	import CarbonChat from "~icons/carbon/chat";
	import CarbonTrashCan from "~icons/carbon/trash-can";

	interface Props {
		comments: ReviewComment[];
		editable: boolean;
		onremove: (id: string) => void;
		onseek?: (time: ReviewTime) => void;
	}

	let { comments, editable, onremove, onseek }: Props = $props();

	let numbers = $derived(pinNumbers(comments));
</script>

{#if comments.length > 0}
	<div class="flex flex-col gap-2.5" data-anchored-notes>
		{#each comments as comment (comment.id)}
			{@const n = numbers.get(comment.id)}
			<div
				id="review-comment-{comment.id}"
				class="group/comment flex items-start gap-2.5 text-[13px] leading-normal"
				data-comment={comment.id}
			>
				{#if n}
					<span
						class="flex size-5 flex-none items-center justify-center rounded-full bg-amber-500 text-[11px] font-bold text-gray-900 dark:bg-amber-400"
					>
						{n}
					</span>
				{:else}
					<CarbonChat class="mt-[3px] flex-none text-sm text-amber-700 dark:text-amber-400" />
				{/if}
				{#if comment.time}
					{@const time = comment.time}
					<button
						type="button"
						class="flex-none pt-px font-mono text-[11.5px] font-medium text-blue-600 hover:underline dark:text-blue-400"
						aria-label="Go to {formatTime(time)}"
						disabled={!onseek}
						onclick={() => onseek?.(time)}
					>
						{formatTime(time)}
					</button>
				{:else if comment.area}
					<span class="flex-none pt-px font-mono text-[11.5px] text-gray-500 dark:text-gray-400">
						{formatArea(comment.area)}
					</span>
				{/if}
				<span
					class="min-w-0 flex-1 break-words whitespace-pre-wrap text-gray-700 dark:text-gray-300"
				>
					{comment.body}
				</span>
				{#if editable}
					<button
						type="button"
						class="flex-none rounded-sm p-0.5 text-gray-400 opacity-0 group-hover/comment:opacity-100 hover:text-red-600 focus:opacity-100"
						aria-label="Delete comment"
						onclick={() => onremove(comment.id)}
					>
						<CarbonTrashCan class="text-xs" />
					</button>
				{/if}
			</div>
		{/each}
	</div>
{/if}
