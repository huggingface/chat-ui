<script lang="ts">
	interface Turn {
		role: string;
		content: string;
	}

	interface Props {
		value: Turn[];
		clamp?: boolean;
	}

	let { value, clamp = false }: Props = $props();

	const CLAMPED_TURNS = 2;

	let shown = $derived(clamp ? value.slice(0, CLAMPED_TURNS) : value);
</script>

<div class="flex min-w-0 flex-col gap-1.5">
	{#each shown as turn, i (i)}
		{@const user = turn.role === "user"}
		{@const system = turn.role === "system"}
		<div class={["flex flex-col gap-0.5", user ? "items-end" : "items-start"]}>
			<span class="text-[11px] font-medium text-gray-400 uppercase dark:text-gray-500">
				{turn.role}
			</span>
			<div
				class={[
					"max-w-[85%] rounded-xl px-3 py-1.5 text-sm break-words whitespace-pre-wrap",
					user && "bg-blue-50 text-gray-800 dark:bg-blue-500/15 dark:text-gray-100",
					system && "bg-gray-50 text-gray-500 italic dark:bg-gray-800 dark:text-gray-400",
					!user && !system && "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-200",
					clamp && "line-clamp-3",
				]}
			>
				{turn.content}
			</div>
		</div>
	{/each}
	{#if shown.length < value.length}
		<span class="text-xs text-gray-400 dark:text-gray-500">
			{value.length - shown.length} more turn{value.length - shown.length === 1 ? "" : "s"}
		</span>
	{/if}
</div>
