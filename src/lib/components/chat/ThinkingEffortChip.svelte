<script lang="ts">
	import { DropdownMenu } from "bits-ui";
	import CarbonCaretDown from "~icons/carbon/caret-down";
	import LucideCheck from "~icons/lucide/check";
	import { useSettingsStore } from "$lib/stores/settings";
	import type { ReasoningEffort } from "$lib/types/Settings";

	interface Props {
		modelId: string;
	}

	let { modelId }: Props = $props();

	const settings = useSettingsStore();

	let current = $derived($settings.reasoningEffortOverrides?.[modelId]);
	let label = $derived(current ? capitalize(current) : "Default");

	function capitalize(s: string) {
		return s.charAt(0).toUpperCase() + s.slice(1);
	}

	function setEffort(value: ReasoningEffort | undefined) {
		const next = { ...($settings.reasoningEffortOverrides ?? {}) };
		if (value === undefined) {
			delete next[modelId];
		} else {
			next[modelId] = value;
		}
		// Persist immediately so the next message picks up the new effort,
		// avoiding the 300ms debounce in `setSettings`.
		settings.instantSet({ reasoningEffortOverrides: next });
	}

	const OPTIONS: { value: ReasoningEffort | undefined; label: string }[] = [
		{ value: undefined, label: "Default" },
		{ value: "low", label: "Low" },
		{ value: "medium", label: "Medium" },
		{ value: "high", label: "High" },
	];
</script>

<DropdownMenu.Root>
	<DropdownMenu.Trigger
		class="inline-flex items-center gap-1 hover:underline"
		aria-label="Select thinking effort"
		title="Thinking effort"
	>
		Effort: {label}
		<CarbonCaretDown class="-ml-0.5 text-xxs" />
	</DropdownMenu.Trigger>
	<DropdownMenu.Portal>
		<DropdownMenu.Content
			class="z-50 min-w-[10rem] rounded-xl border border-gray-200 bg-white/95 p-1 text-gray-800 shadow-lg backdrop-blur dark:border-gray-700/60 dark:bg-gray-800/95 dark:text-gray-100"
			side="top"
			align="end"
			sideOffset={6}
		>
			{#each OPTIONS as opt (opt.label)}
				<DropdownMenu.Item
					class="flex h-8 cursor-pointer select-none items-center justify-between gap-2 rounded-md px-2 text-sm data-[highlighted]:bg-gray-100 focus-visible:outline-none dark:data-[highlighted]:bg-white/10"
					onSelect={() => setEffort(opt.value)}
				>
					<span>{opt.label}</span>
					{#if current === opt.value}
						<LucideCheck class="size-4 text-gray-500" />
					{/if}
				</DropdownMenu.Item>
			{/each}
		</DropdownMenu.Content>
	</DropdownMenu.Portal>
</DropdownMenu.Root>
