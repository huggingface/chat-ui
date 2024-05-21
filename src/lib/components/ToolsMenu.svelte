<script lang="ts">
	import { page } from "$app/stores";
	import { useSettingsStore } from "$lib/stores/settings";
	import type { ToolFront } from "$lib/types/Tool";
	import IconTool from "./icons/IconTool.svelte";

	export let loading = false;
	const settings = useSettingsStore();

	// active tools are all the checked tools, either from settings or on by default
	$: activeToolCount = $page.data.tools.filter(
		(tool: ToolFront) => $settings?.tools?.[tool.name] ?? tool.isOnByDefault
	).length;
</script>

<details class="group relative bottom-0 h-full min-h-8">
	<summary
		class="absolute bottom-0 flex h-8
	cursor-pointer select-none items-center gap-1 rounded-lg border bg-white px-2 py-1.5 shadow-sm hover:shadow-none dark:border-gray-800 dark:bg-gray-900"
	>
		<IconTool />
		Tools
		<span class="text-gray-400 dark:text-gray-500"> ({activeToolCount}) </span>
	</summary>
	<div
		class="absolute bottom-10 h-max w-max
	cursor-pointer select-none items-center gap-1 rounded-lg border bg-white p-0.5 shadow-sm dark:border-gray-800 dark:bg-gray-900"
	>
		<div class="grid grid-cols-2 gap-x-6 gap-y-1 p-3">
			{#each $page.data.tools as tool}
				{@const isChecked = $settings?.tools?.[tool.name] ?? tool.isOnByDefault}
				<div class="flex items-center gap-1.5">
					<input
						type="checkbox"
						id={tool.name}
						checked={isChecked}
						disabled={loading}
						on:click={async () => {
							await settings.instantSet({
								tools: {
									...$settings.tools,
									[tool.name]: !isChecked,
								},
							});
						}}
					/>
					<label class="cursor-pointer" for={tool.name}>{tool.displayName ?? tool.name} </label>
				</div>
			{/each}
		</div>
	</div>
</details>
