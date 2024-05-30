<script lang="ts">
	import { page } from "$app/stores";
	import { clickOutside } from "$lib/actions/clickOutside";
	import { useSettingsStore } from "$lib/stores/settings";
	import type { ToolFront } from "$lib/types/Tool";
	import { isHuggingChat } from "$lib/utils/isHuggingChat";
	import IconTool from "./icons/IconTool.svelte";
	import CarbonInformation from "~icons/carbon/information";

	export let loading = false;
	const settings = useSettingsStore();

	let detailsEl: HTMLDetailsElement;

	// active tools are all the checked tools, either from settings or on by default
	$: activeToolCount = $page.data.tools.filter(
		(tool: ToolFront) => $settings?.tools?.[tool.name] ?? tool.isOnByDefault
	).length;

	function setAllTools(value: boolean) {
		settings.instantSet({
			tools: Object.fromEntries($page.data.tools.map((tool: ToolFront) => [tool.name, value])),
		});
	}
	$: allToolsEnabled = activeToolCount === $page.data.tools.length;
</script>

<details
	class="group relative bottom-0 h-full min-h-8"
	bind:this={detailsEl}
	use:clickOutside={() => {
		if (detailsEl.hasAttribute("open")) {
			detailsEl.removeAttribute("open");
		}
	}}
>
	<summary
		class="absolute bottom-0 flex h-8
	cursor-pointer select-none items-center gap-1 rounded-lg border bg-white px-2 py-1.5 shadow-sm hover:shadow-none dark:border-gray-800 dark:bg-gray-900"
	>
		<IconTool classNames="dark:text-purple-600" />
		Tools
		<span class="text-gray-400 dark:text-gray-500"> ({activeToolCount}) </span>
	</summary>
	<div
		class="absolute bottom-10 h-max w-max select-none items-center gap-1 rounded-lg border bg-white p-0.5 shadow-sm dark:border-gray-800 dark:bg-gray-900"
	>
		<div class="grid grid-cols-2 gap-x-6 gap-y-1 p-3">
			<div class="col-span-2 flex items-center gap-1.5 text-sm text-gray-500">
				Available tools
				{#if isHuggingChat}
					<a
						href="https://huggingface.co/spaces/huggingchat/chat-ui/discussions/470"
						target="_blank"
						class="hover:brightness-0 dark:hover:brightness-200"
						><CarbonInformation class="text-xs" /></a
					>
				{/if}
				<button
					class="ml-auto text-xs underline"
					on:click|stopPropagation={() => setAllTools(!allToolsEnabled)}
				>
					{#if allToolsEnabled}
						Disable all
					{:else}
						Enable all
					{/if}
				</button>
			</div>
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

<style>
	details summary::-webkit-details-marker {
		display: none;
	}
</style>
