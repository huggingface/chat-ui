<script lang="ts">
	import type { SlashCommand } from "$lib/utils/slashCommands";

	interface Props {
		commands: SlashCommand[];
		activeIndex: number;
		/** where the leading slash sits, relative to the composer box */
		caretAnchor: { left: number; bottom: number };
		onselect: (command: SlashCommand) => void;
		onactivechange: (index: number) => void;
	}

	let { commands, activeIndex, caretAnchor, onselect, onactivechange }: Props = $props();
</script>

<div class="sr-only" role="status" aria-live="polite">
	{`${commands.length} ${commands.length === 1 ? "command" : "commands"} available`}
</div>

<div
	class="pointer-events-none absolute z-30"
	style="left: {caretAnchor.left}px; bottom: {caretAnchor.bottom}px;"
>
	<div
		id="slash-command-listbox"
		role="listbox"
		aria-label="Commands"
		class="pointer-events-auto scrollbar-custom max-h-64 w-72 max-w-[min(20rem,calc(100vw-2rem))] overflow-y-auto rounded-lg border border-gray-200 bg-white py-1 text-[13px] shadow-lg dark:border-gray-700 dark:bg-gray-900"
	>
		{#each commands as command, index (command.name)}
			<button
				id={`slash-command-option-${index}`}
				data-command={command.name}
				type="button"
				role="option"
				aria-selected={index === activeIndex}
				class={[
					"flex w-full items-baseline gap-2 px-2.5 py-1 text-left focus:outline-hidden",
					index === activeIndex
						? "bg-gray-100 dark:bg-gray-800"
						: "hover:bg-gray-50 dark:hover:bg-gray-800/60",
				]}
				onpointerdown={(event) => event.preventDefault()}
				onpointermove={(event) => {
					// only a pointer that moved, the panel can open under a resting mouse
					if ((event.movementX || event.movementY) && index !== activeIndex) {
						onactivechange(index);
					}
				}}
				onclick={() => onselect(command)}
			>
				<span class="shrink-0 font-medium text-gray-800 dark:text-gray-200">/{command.name}</span>
				<span class="min-w-0 truncate text-gray-500 dark:text-gray-400">{command.description}</span>
			</button>
		{/each}
	</div>
</div>
