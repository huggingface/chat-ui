<script lang="ts">
	import type { MessageToolUpdate } from "$lib/types/MessageUpdate";
	import {
		describeToolActivity,
		thoughtLabel,
		type ActivityKind,
		type ActivityLabels,
	} from "$lib/utils/activity";
	import { isMessageToolProgressUpdate } from "$lib/utils/messageUpdates";
	import { formatToolProgressCount } from "$lib/utils/toolProgress";
	import CarbonChevronRight from "~icons/carbon/chevron-right";
	import LucideSearch from "~icons/lucide/search";
	import LucideGlobe from "~icons/lucide/globe";
	import LucideTerminal from "~icons/lucide/terminal";
	import LucideSquarePlus from "~icons/lucide/square-plus";
	import LucideFilePen from "~icons/lucide/file-pen";
	import LucideFileText from "~icons/lucide/file-text";
	import LucideImage from "~icons/lucide/image";
	import LucideEye from "~icons/lucide/eye";
	import LucideWrench from "~icons/lucide/wrench";
	import LucideLightbulb from "~icons/lucide/lightbulb";
	import ActivityStepDetail from "./ActivityStepDetail.svelte";

	type ProcessBlock =
		| { type: "think"; content: string; closed: boolean; round?: number }
		| { type: "tool"; uuid: string; updates: MessageToolUpdate[]; round?: number };

	interface Props {
		block: ProcessBlock;
		labels: ActivityLabels;
		/** the turn is still streaming, so a call without a result is still running */
		loading?: boolean;
		/** the group this row belongs to is the one the turn is working on */
		active?: boolean;
		/** identical consecutive calls folded into this row */
		count?: number;
	}

	let { block, labels, loading = false, active = false, count = 1 }: Props = $props();

	let isOpen = $state(false);

	const ICONS: Record<ActivityKind, typeof LucideSearch> = {
		search: LucideSearch,
		page: LucideGlobe,
		code: LucideTerminal,
		create: LucideSquarePlus,
		write: LucideFilePen,
		file: LucideFileText,
		image: LucideImage,
		lookup: LucideEye,
		other: LucideWrench,
	};

	let tool = $derived(
		block.type === "tool" ? describeToolActivity(block.updates, loading) : undefined
	);
	let thinkingStreams = $derived(block.type === "think" && !block.closed && active);
	let thinkingText = $derived.by(() => {
		if (block.type !== "think") return "";
		const round = block.round ?? 0;
		if (thinkingStreams) return labels.thinking.get(round) ?? "Thinking";
		return thoughtLabel(labels, round, block.content);
	});
	let progressCount = $derived.by(() => {
		if (block.type !== "tool" || tool?.status !== "running") return undefined;
		for (let i = block.updates.length - 1; i >= 0; i -= 1) {
			const update = block.updates[i];
			if (isMessageToolProgressUpdate(update)) return formatToolProgressCount(update);
		}
		return undefined;
	});
	let Icon = $derived(tool ? ICONS[tool.kind] : LucideLightbulb);
</script>

{#if block.type === "tool" ? tool : block.content.trim().length > 0}
	<div class="min-w-0">
		<button
			type="button"
			class="group/row flex w-full min-w-0 cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-[13px] outline-none select-none hover:bg-gray-50 focus-visible:bg-gray-50 focus-visible:ring-2 focus-visible:ring-blue-500/70 focus-visible:ring-inset dark:hover:bg-gray-800/60 dark:focus-visible:bg-gray-800/60 dark:focus-visible:ring-blue-400/70"
			aria-expanded={isOpen}
			onclick={() => (isOpen = !isOpen)}
		>
			<Icon class="size-3.5 shrink-0 text-gray-400 dark:text-gray-500" />
			{#if block.type === "think"}
				<span
					class="min-w-0 truncate text-gray-600 dark:text-gray-300"
					class:router-shimmer={thinkingStreams && !labels.thinking.has(block.round ?? 0)}
				>
					{thinkingText}
				</span>
			{:else if tool}
				<span
					class="shrink-0 text-gray-600 dark:text-gray-300"
					class:router-shimmer={tool.status === "running"}>{tool.verb}</span
				>
				{#if tool.subject}
					<span
						class="min-w-0 truncate text-gray-500 dark:text-gray-400 {tool.mono
							? 'font-mono text-xs'
							: ''}">{tool.subject}</span
					>
				{/if}
				{#if tool.detail}
					<span class="shrink-0 text-xs text-gray-400 dark:text-gray-500">{tool.detail}</span>
				{/if}
				{#if count > 1}
					<span class="shrink-0 text-xs text-gray-400 tabular-nums dark:text-gray-500"
						>×{count}</span
					>
				{/if}
				{#if progressCount}
					<span class="shrink-0 text-xs text-gray-400 tabular-nums">({progressCount})</span>
				{/if}
				{#if tool.status === "error"}
					<span class="shrink-0 text-xs font-medium text-amber-600 dark:text-amber-400">Failed</span
					>
				{:else if tool.status === "stopped"}
					<span class="shrink-0 text-xs text-gray-400 dark:text-gray-500">Stopped</span>
				{/if}
			{/if}
			<CarbonChevronRight
				class="ml-auto size-3.5 shrink-0 text-gray-400 transition-transform duration-200 {isOpen
					? 'rotate-90'
					: ''}"
			/>
		</button>
		{#if isOpen}
			<div class="min-w-0 px-3 pt-1 pb-3 pl-8.5">
				<ActivityStepDetail {block} {loading} />
			</div>
		{/if}
	</div>
{/if}
