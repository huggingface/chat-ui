<script lang="ts" module>
	// Kept per group across remounts: the streamed message is replaced by its stored copy when the
	// turn ends, which would otherwise close an open card, restart the timer and drop focus.
	const openGroups = new Set<string>();
	const startTimes = new Map<string, number>();
	let focusedGroup: string | undefined;
</script>

<script lang="ts">
	import type { MessageToolUpdate } from "$lib/types/MessageUpdate";
	import {
		collapseSteps,
		describeToolActivity,
		isRenderableStep,
		summarizeActivity,
		thoughtLabel,
		type ActivityLabels,
	} from "$lib/utils/activity";
	import CarbonChevronRight from "~icons/carbon/chevron-right";
	import ActivityRow from "./ActivityRow.svelte";
	import ActivityStepDetail from "./ActivityStepDetail.svelte";

	type ProcessBlock =
		| { type: "think"; content: string; closed: boolean; round?: number }
		| { type: "tool"; uuid: string; updates: MessageToolUpdate[]; round?: number };

	interface Props {
		blocks: ProcessBlock[];
		labels: ActivityLabels;
		/** the turn is still working on this run of steps: show the live label and a timer */
		active?: boolean;
		/** the turn is still streaming, so a call without a result is still running */
		loading?: boolean;
	}

	let { blocks, labels, active = false, loading = false }: Props = $props();

	let steps = $derived(blocks.filter(isRenderableStep));
	/** one step needs no list: opening the line shows the step itself */
	let single = $derived(steps.length === 1 ? steps[0] : undefined);
	/** tool call ids come from the server, so they survive the swap to the stored message */
	let key = $derived.by(() => {
		const firstTool = steps.find((step) => step.type === "tool");
		if (firstTool?.type === "tool") return `tool:${firstTool.uuid}`;
		const first = steps[0];
		return first?.type === "think" ? `think:${first.round ?? 0}:${first.content.slice(0, 48)}` : "";
	});

	let isOpen = $state(false);
	let headerEl: HTMLButtonElement | undefined = $state();
	const panelId = `activity-${Math.random().toString(36).slice(2, 10)}`;

	$effect(() => {
		if (openGroups.has(key)) isOpen = true;
		else if (isOpen) openGroups.add(key);
	});

	function toggle() {
		isOpen = !isOpen;
		if (isOpen) openGroups.add(key);
		else openGroups.delete(key);
	}

	// Seconds since this run started; the start is kept per group so a remount does not reset it.
	let now = $state(Date.now());
	let startedAt = $derived.by(() => {
		if (!key) return now;
		if (!startTimes.has(key)) startTimes.set(key, Date.now());
		return startTimes.get(key) ?? now;
	});
	$effect(() => {
		if (!active) return;
		now = Date.now();
		const id = setInterval(() => (now = Date.now()), 1000);
		return () => clearInterval(id);
	});
	let seconds = $derived(Math.max(0, Math.floor((now - startedAt) / 1000)));

	let tools = $derived(
		steps.flatMap((step) => {
			if (step.type !== "tool") return [];
			const activity = describeToolActivity(step.updates, loading);
			return activity ? [activity] : [];
		})
	);

	/** The task model's line for the round in progress, if it fits what the round is doing now. */
	let modelLabel = $derived.by(() => {
		const round = Math.max(0, ...steps.map((step) => step.round ?? 0));
		const hasCalls = steps.some((step) => step.type === "tool" && (step.round ?? 0) === round);
		if (hasCalls) return labels.tools.get(round);
		return labels.thinking.get(round) ?? labels.summary.get(round);
	});

	/** What the rules can tell from the last step, never in the past tense while working. */
	let ruleLabel = $derived.by(() => {
		const last = steps.at(-1);
		if (last?.type === "tool") {
			const activity = describeToolActivity(last.updates, loading);
			if (activity?.status === "running") return activity.verb;
		}
		return "Thinking";
	});

	// The live line holds a model label for up to 4s while the next one is written, and shows any
	// text for at least a second, so it neither drops back to generic words nor flickers.
	let liveText = $state("");
	let liveFromModel = false;
	let liveSince = 0;
	$effect(() => {
		if (!active) return;
		void now;
		const t = Date.now();
		const settled = t - liveSince >= 1000 || !liveText;
		if (modelLabel) {
			if (modelLabel !== liveText && settled) {
				liveText = modelLabel;
				liveFromModel = true;
				liveSince = t;
			}
		} else if (!(liveFromModel && t - liveSince < 4000) && ruleLabel !== liveText && settled) {
			liveText = ruleLabel;
			liveFromModel = false;
			liveSince = t;
		}
	});

	/** Once finished: the calls in words, or what the reasoning was about. */
	let summary = $derived.by(() => {
		if (single?.type === "tool") {
			const activity = tools[0];
			return {
				text: activity?.verb ?? "Used a tool",
				subject: activity?.subject,
				mono: activity?.mono,
				stopped: false,
			};
		}
		if (tools.length > 0) return { ...summarizeActivity(tools), subject: undefined, mono: false };
		const lastThink = steps.findLast((step) => step.type === "think");
		return {
			text: lastThink ? thoughtLabel(labels, lastThink.round ?? 0, lastThink.content) : "Thought",
			subject: undefined,
			mono: false,
			stopped: false,
		};
	});

	let label = $derived(active ? liveText || ruleLabel : summary.text);

	// Screen readers hear the live line once it has settled, and the summary when the run ends.
	let announcement = $state("");
	let wasActive = false;
	$effect(() => {
		void now;
		if (active) {
			wasActive = true;
			if (liveText && Date.now() - liveSince >= 1500 && announcement !== liveText) {
				announcement = liveText;
			}
		} else if (wasActive) {
			announcement = `Done: ${summary.text}`;
		}
	});

	$effect(() => {
		if (headerEl && key && focusedGroup === key && document.activeElement === document.body) {
			headerEl.focus({ preventScroll: true });
		}
	});
</script>

<div class="flex max-w-full min-w-0 flex-col items-start">
	<button
		bind:this={headerEl}
		type="button"
		class="group/header flex max-w-full min-w-0 cursor-pointer items-center gap-1.5 rounded-sm text-left outline-none select-none focus-visible:ring-2 focus-visible:ring-blue-500/70 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-blue-400/70 dark:focus-visible:ring-offset-gray-800"
		aria-expanded={isOpen}
		aria-controls={isOpen ? panelId : undefined}
		onclick={toggle}
		onfocus={() => (focusedGroup = key)}
		onblur={() => {
			if (focusedGroup === key) focusedGroup = undefined;
		}}
	>
		{#key label}
			<span
				class="activity-label-in min-w-0 truncate text-sm font-medium transition-colors group-hover/header:text-gray-600 dark:group-hover/header:text-gray-300 {isOpen
					? 'text-gray-600 dark:text-gray-300'
					: 'text-gray-500 dark:text-gray-400'}"
				class:router-shimmer={active}
			>
				{label}
			</span>
		{/key}
		{#if !active && summary.subject}
			<span
				class="min-w-0 truncate text-sm text-gray-400 dark:text-gray-500 {summary.mono
					? 'font-mono text-xs'
					: ''}"
			>
				{summary.subject}
			</span>
		{/if}
		{#if !active && summary.stopped}
			<span class="shrink-0 text-sm text-gray-400 dark:text-gray-500">· stopped</span>
		{/if}
		{#if active}
			<span
				class="shrink-0 text-xs text-gray-400 tabular-nums dark:text-gray-500"
				aria-hidden="true">{seconds}s</span
			>
		{/if}
		<CarbonChevronRight
			class="size-3.5 shrink-0 transition-all duration-200 group-hover/header:text-gray-600 dark:group-hover/header:text-gray-300 {isOpen
				? 'rotate-90 text-gray-600 dark:text-gray-300'
				: 'text-gray-400'}"
		/>
	</button>
	<span class="sr-only" role="status" aria-live="polite">{announcement}</span>

	{#if isOpen && single}
		<div id={panelId} class="mt-1.5 w-full min-w-0">
			<ActivityStepDetail block={single} {loading} />
		</div>
	{:else if isOpen}
		<div
			id={panelId}
			class="mt-1.5 w-full min-w-0 divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200 bg-white/60 dark:divide-gray-800 dark:border-gray-700/70 dark:bg-gray-900/30"
		>
			{#each collapseSteps(steps, loading) as { block, count }, i (block.type === "tool" ? `tool-${block.uuid}` : `think-${i}`)}
				<ActivityRow {block} {labels} {loading} {active} {count} />
			{/each}
		</div>
	{/if}
</div>
