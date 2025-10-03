<script lang="ts">
	import { MessageToolUpdateType, type MessageToolUpdate } from "$lib/types/MessageUpdate";
	import {
		isMessageToolCallUpdate,
		isMessageToolErrorUpdate,
		isMessageToolResultUpdate,
	} from "$lib/utils/messageUpdates";
	import CarbonTools from "~icons/carbon/tools";
	import { ToolResultStatus, type ToolFront } from "$lib/types/Tool";
	import { page } from "$app/state";
	import { onDestroy } from "svelte";
	import { browser } from "$app/environment";

	interface Props {
		tool: MessageToolUpdate[];
		loading?: boolean;
	}

	let { tool, loading = false }: Props = $props();

	const toolFnName = tool.find(isMessageToolCallUpdate)?.call.name;
	let toolError = $derived(tool.some(isMessageToolErrorUpdate));
	let toolDone = $derived(tool.some(isMessageToolResultUpdate));
	let eta = $derived(tool.find((update) => update.subtype === MessageToolUpdateType.ETA)?.eta);

	const toolsData = page.data as { tools?: ToolFront[] } | undefined;
	const availableTools: ToolFront[] = toolsData?.tools ?? [];

	let loadingBarEl: HTMLDivElement | undefined = $state();
	let animation: Animation | undefined = $state();
	let showingLoadingBar = $state(false);

	$effect(() => {
		if (!toolError && !toolDone && loading && loadingBarEl && eta) {
			loadingBarEl.classList.remove("hidden");
			showingLoadingBar = true;
			animation = loadingBarEl.animate([{ width: "0%" }, { width: "calc(100%+1rem)" }], {
				duration: eta * 1000,
				fill: "forwards",
			});
		}
	});

	onDestroy(() => {
		animation?.cancel();
	});

	$effect(() => {
		if ((!loading || toolDone || toolError) && browser && loadingBarEl && showingLoadingBar) {
			showingLoadingBar = false;
			loadingBarEl.classList.remove("hidden");
			animation?.cancel();
			animation = loadingBarEl.animate(
				[{ width: loadingBarEl.style.width }, { width: "calc(100%+1rem)" }],
				{ duration: 300, fill: "forwards" }
			);
			setTimeout(() => loadingBarEl?.classList.add("hidden"), 300);
		}
	});
</script>

{#if toolFnName}
	<details
		class="group/tool my-2.5 w-fit max-w-full cursor-pointer rounded-lg border border-gray-200 bg-white pl-1 pr-2.5 text-sm shadow-sm transition-all first:mt-0 open:mb-3 open:border-purple-500/10 open:bg-purple-600/5 open:shadow-sm dark:border-gray-800 dark:bg-gray-900 open:dark:border-purple-800/40 open:dark:bg-purple-800/10 [&+details]:-mt-2"
	>
		<summary
			class="relative flex select-none list-none items-center gap-1.5 py-1 group-open/tool:text-purple-700 group-open/tool:dark:text-purple-300"
		>
			<div
				bind:this={loadingBarEl}
				class="absolute -m-1 hidden h-full w-[calc(100%+1rem)] rounded-lg bg-purple-500/5 transition-all dark:bg-purple-500/10"
			></div>

			<div
				class="relative grid size-[22px] place-items-center rounded bg-purple-600/10 dark:bg-purple-600/20"
			>
				<svg
					class="absolute inset-0 text-purple-500/40 transition-opacity"
					class:invisible={toolDone || toolError}
					width="22"
					height="22"
					viewBox="0 0 38 38"
					fill="none"
					xmlns="http://www.w3.org/2000/svg"
				>
					<path
						class="loading-path"
						d="M8 2.5H30C30 2.5 35.5 2.5 35.5 8V30C35.5 30 35.5 35.5 30 35.5H8C8 35.5 2.5 35.5 2.5 30V8C2.5 8 2.5 2.5 8 2.5Z"
						stroke="currentColor"
						stroke-width="1"
						stroke-linecap="round"
						id="shape"
					/>
				</svg>
				<CarbonTools class="text-xs text-purple-700 dark:text-purple-500" />
			</div>

			<span>
				{toolError ? "Error calling" : toolDone ? "Called" : "Calling"} tool
				<span class="font-semibold">
					{availableTools.find((entry) => entry.name === toolFnName)?.displayName ?? toolFnName}
				</span>
			</span>
		</summary>

		{#each tool as update}
			{#if update.subtype === MessageToolUpdateType.Call}
				<div class="mt-1 flex items-center gap-2 opacity-80">
					<h3 class="text-sm">Parameters</h3>
					<div class="h-px flex-1 bg-gradient-to-r from-gray-500/20"></div>
				</div>
				<ul class="py-1 text-sm">
					{#each Object.entries(update.call.parameters ?? {}) as [key, value]}
						{#if value !== null}
							<li>
								<span class="font-semibold">{key}</span>:
								<span>{value}</span>
							</li>
						{/if}
					{/each}
				</ul>
			{:else if update.subtype === MessageToolUpdateType.Error}
				<div class="mt-1 flex items-center gap-2 opacity-80">
					<h3 class="text-sm">Error</h3>
					<div class="h-px flex-1 bg-gradient-to-r from-gray-500/20"></div>
				</div>
				<p class="text-sm">{update.message}</p>
			{:else if isMessageToolResultUpdate(update) && update.result.status === ToolResultStatus.Success && update.result.display}
				<div class="mt-1 flex items-center gap-2 opacity-80">
					<h3 class="text-sm">Result</h3>
					<div class="h-px flex-1 bg-gradient-to-r from-gray-500/20"></div>
				</div>
				<ul class="py-1 text-sm">
					{#each update.result.outputs as output}
						{#each Object.entries(output) as [key, value]}
							{#if value !== null}
								<li>
									<span class="font-semibold">{key}</span>:
									<span>{value}</span>
								</li>
							{/if}
						{/each}
					{/each}
				</ul>
			{/if}
		{/each}
	</details>
{/if}

<style>
	details summary::-webkit-details-marker {
		display: none;
	}

	.loading-path {
		stroke-dasharray: 61.45;
		animation: loading 2s linear infinite;
	}
</style>
