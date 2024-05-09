<script lang="ts">
	import { page } from "$app/stores";
	import { useSettingsStore } from "$lib/stores/settings";

	const settings = useSettingsStore();
</script>

<details class="group relative h-full">
	<summary
		class="flex h-8
	cursor-pointer select-none items-center gap-1 rounded-lg border bg-white p-1.5 shadow-sm group-open:absolute group-open:bottom-0 hover:shadow-none dark:border-gray-800 dark:bg-gray-900"
	>
		Tools
		<span class="text-gray-500 dark:text-gray-400"> (4) </span>
	</summary>
	<div class="absolute bottom-10 h-max w-max border-2 bg-gray-200">
		<div class="grid grid-cols-2 gap-x-4 p-2">
			{#each $page.data.tools as tool}
				{@const isChecked = $settings?.tools?.[tool.name] ?? tool.isOnByDefault}
				<div class="flex items-center gap-2">
					<input
						type="checkbox"
						id={tool.name}
						checked={isChecked}
						on:click={async () => {
							await settings.instantSet({
								tools: {
									...$settings.tools,
									[tool.name]: !isChecked,
								},
							});
						}}
					/>
					<label class="cursor-pointer" for={tool.name}
						>{tool.displayName ?? tool.name} - {isChecked}
					</label>
				</div>
			{/each}
		</div>
	</div>
</details>
