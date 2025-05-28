<script lang="ts">
	import { base } from "$app/paths";
	import { page } from "$app/state";
	import { clickOutside } from "$lib/actions/clickOutside";
	import { useSettingsStore } from "$lib/stores/settings";
	import type { ToolFront } from "$lib/types/Tool";
	import IconTool from "./icons/IconTool.svelte";
	import CarbonInformation from "~icons/carbon/information";
	import CarbonGlobe from "~icons/carbon/earth-filled";
	import { usePublicConfig } from "$lib/utils/PublicConfig.svelte";

	const publicConfig = usePublicConfig();

	interface Props {
		loading?: boolean;
	}

	let { loading = false }: Props = $props();
	const settings = useSettingsStore();

	let detailsEl: HTMLDetailsElement | undefined = $state();

	// active tools are all the checked tools, either from settings or on by default
	let activeToolCount = $derived(
		page.data.tools.filter(
			(tool: ToolFront) =>
				// community tools are always on by default
				tool.type === "community" || $settings?.tools?.includes(tool._id)
		).length
	);

	async function setAllTools(value: boolean) {
		const configToolsIds = page.data.tools
			.filter((t: ToolFront) => t.type === "config")
			.map((t: ToolFront) => t._id);

		if (value) {
			await settings.instantSet({
				tools: Array.from(new Set([...configToolsIds, ...($settings?.tools ?? [])])),
			});
		} else {
			await settings.instantSet({
				tools: [],
			});
		}
	}

	let allToolsEnabled = $derived(activeToolCount === page.data.tools.length);

	let tools = $derived(page.data.tools);
</script>

<details
	class="group relative bottom-0 h-full min-h-8"
	bind:this={detailsEl}
	use:clickOutside={() => {
		if (detailsEl?.hasAttribute("open")) {
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
				{#if publicConfig.isHuggingChat}
					<a
						href="https://huggingface.co/spaces/huggingchat/chat-ui/discussions/470"
						target="_blank"
						class="hover:brightness-0 dark:hover:brightness-200"
						><CarbonInformation class="text-xs" /></a
					>
				{/if}
				<button
					class="ml-auto text-xs underline"
					onclick={(e) => {
						e.stopPropagation();
						setAllTools(!allToolsEnabled);
					}}
				>
					{#if allToolsEnabled}
						Disable all
					{:else}
						Enable all
					{/if}
				</button>
			</div>
			{#if page.data.enableCommunityTools}
				<a
					href="{base}/tools"
					class="col-span-2 my-1 h-fit w-fit items-center justify-center rounded-full bg-purple-500/20 px-2.5 py-1.5 text-sm hover:bg-purple-500/30"
				>
					<span class="mr-1 rounded-full bg-purple-700 px-1.5 py-1 text-xs font-bold uppercase">
						new
					</span>
					Browse community tools ({page.data.communityToolCount ?? 0})
				</a>
			{/if}
			{#each tools as tool}
				{@const isChecked = $settings?.tools?.includes(tool._id)}
				<div class="flex items-center gap-1.5">
					{#if tool.type === "community"}
						<input
							type="checkbox"
							id={tool._id}
							checked={true}
							class="rounded-xs font-semibold accent-purple-500 hover:accent-purple-600"
							onclick={async (e) => {
								e.preventDefault();
								e.stopPropagation();
								await settings.instantSet({
									tools: $settings?.tools?.filter((t) => t !== tool._id) ?? [],
								});
							}}
						/>
					{:else}
						<input
							type="checkbox"
							id={tool._id}
							checked={isChecked}
							disabled={loading}
							onclick={async (e) => {
								e.preventDefault();
								e.stopPropagation();
								if (isChecked) {
									await settings.instantSet({
										tools: ($settings?.tools ?? []).filter((t) => t !== tool._id),
									});
								} else {
									await settings.instantSet({
										tools: [...($settings?.tools ?? []), tool._id],
									});
								}
							}}
						/>
					{/if}
					<label class="cursor-pointer" for={tool._id}>{tool.displayName}</label>
					{#if tool.type === "community"}
						<a href="{base}/tools/{tool._id}" class="text-purple-600 hover:text-purple-700">
							<CarbonGlobe />
						</a>
					{/if}
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
