<script lang="ts" module>
	export type BarState = "answered" | "skipped" | "todo" | "pass" | "fail";
</script>

<script lang="ts">
	import { progressRuns } from "$lib/utils/review/progress";

	interface Props {
		states: BarState[];
		/** the record on show, marked in blue */
		current?: number;
		commented?: ReadonlySet<number>;
		onseek?: (index: number) => void;
		label: string;
	}

	let { states, current, commented = new Set(), onseek, label }: Props = $props();

	const STATE_LABEL: Record<BarState, string> = {
		answered: "answered",
		skipped: "skipped",
		todo: "to do",
		pass: "pass",
		fail: "fail",
	};

	const RUN_CLASS: Record<BarState, string> = {
		answered: "bg-green-600 dark:bg-green-500",
		skipped: "bg-amber-500",
		todo: "",
		pass: "bg-green-600 dark:bg-green-500",
		fail: "bg-red-700 dark:bg-red-500",
	};

	let runs = $derived(progressRuns(states));
	let total = $derived(Math.max(states.length, 1));
	let hover = $state<number | undefined>(undefined);
	const pct = (index: number) => `${(((index + 0.5) / total) * 100).toFixed(3)}%`;

	function indexAt(event: MouseEvent): number {
		const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
		const at = Math.floor(((event.clientX - box.left) / Math.max(box.width, 1)) * total);
		return Math.max(0, Math.min(total - 1, at));
	}

	let tip = $derived.by(() => {
		if (hover === undefined) return "";
		const parts = [`#${hover + 1}`, hover === current ? "current" : STATE_LABEL[states[hover]]];
		if (commented.has(hover)) parts.push("comment");
		return parts.join(" · ");
	});
</script>

<button
	type="button"
	class="relative flex h-7 min-w-0 flex-1 cursor-pointer items-center border-0 bg-transparent p-0 disabled:cursor-default"
	aria-label={label}
	disabled={!onseek}
	data-progress-bar
	onclick={(e) => onseek?.(indexAt(e))}
	onmousemove={(e) => (hover = indexAt(e))}
	onmouseleave={() => (hover = undefined)}
>
	<span class="flex h-2 w-full overflow-hidden rounded bg-gray-100 dark:bg-gray-800">
		{#each runs as run, i (i)}
			<span class="block h-full {RUN_CLASS[run.state]}" style="flex: {run.count} 0 0"></span>
		{/each}
	</span>
	{#each [...commented] as index (index)}
		<span
			class="absolute top-[3px] -ml-px h-1 w-0.5 rounded-sm bg-amber-500"
			style="left: {pct(index)}"
			data-comment-tick={index}
		></span>
	{/each}
	{#if current !== undefined}
		<span
			class="absolute top-1.5 -ml-0.5 h-4 w-1 rounded-sm bg-blue-600 shadow-[0_0_0_2px_white] dark:bg-blue-400 dark:shadow-[0_0_0_2px_rgb(17,17,17)]"
			style="left: {pct(current)}"
			data-current-mark
		></span>
	{/if}
	{#if hover !== undefined && onseek}
		<span
			class="pointer-events-none absolute top-2 -ml-px h-3 w-0.5 rounded-sm bg-gray-900 opacity-45 dark:bg-gray-100"
			style="left: {pct(hover)}"
		></span>
		<span
			class="pointer-events-none absolute top-8 z-20 -translate-x-1/2 rounded-md bg-gray-900 px-2 py-1 text-xs font-medium whitespace-nowrap text-white dark:bg-gray-100 dark:text-gray-900"
			style="left: {pct(hover)}"
			role="tooltip"
		>
			{tip}
		</span>
	{/if}
</button>
