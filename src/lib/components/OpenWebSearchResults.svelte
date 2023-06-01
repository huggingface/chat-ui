<script lang="ts">
	import type { WebSearchMessage } from "$lib/types/WebSearch";
	import CarbonCaretDown from "~icons/carbon/caret-down";

	import CarbonCheckmark from "~icons/carbon/checkmark-filled";
	import IconLoading from "./icons/IconLoading.svelte";
	import EosIconsLoading from "~icons/eos-icons/loading";

	import { base } from "$app/paths";
	import { onMount } from "svelte";

	export let loading = false;
	export let webSearchId: string | undefined;
	export let webSearchMessages: WebSearchMessage[] = [];

	let detailsOpen: boolean;

	onMount(() => {
		if (detailsOpen && webSearchMessages.length === 0 && webSearchId) {
			fetch(`${base}/search/${webSearchId}`)
				.then((res) => res.json())
				.then((res) => {
					webSearchMessages = [...res.messages, { type: "result", id: webSearchId }];
				})
				.catch((err) => console.log(err));
		}
	});
</script>

<details
	class="details flex w-fit rounded-xl border border-gray-200 bg-white px-2 shadow-sm dark:border-gray-600 dark:bg-gray-700
	"
	on:toggle={() => {
		if (webSearchMessages.length === 0 && webSearchId) {
			fetch(`${base}/search/${webSearchId}`)
				.then((res) => res.json())
				.then((res) => {
					webSearchMessages = [...res.messages, { type: "result", id: webSearchId }];
				})
				.catch((err) => console.log(err));
		}
	}}
	bind:open={detailsOpen}
>
	<summary class="align-center mr-2 flex list-none p-2 align-text-top transition-all">
		{#if loading}
			<EosIconsLoading class="my-auto" />
		{:else}
			<CarbonCheckmark class="my-auto" />
		{/if}
		<span class="px-2 font-medium">Web search results</span>
		<div class="my-auto transition-all" class:-rotate-90={detailsOpen}>
			<CarbonCaretDown />
		</div>
	</summary>

	<div class="content p-5 pb-1">
		{#if webSearchMessages.length === 0}
			<div class="mx-auto w-fit">
				<EosIconsLoading class="mb-3 h-10 w-10" />
			</div>
		{:else}
			<ol class="border-gray-20 relative border-l">
				{#each webSearchMessages as message}
					{#if message.type === "update"}
						<li class="mb-4 ml-4">
							<div class="h-3 w-3 -translate-x-[1.4rem] rounded-full bg-gray-200" />
							<h3 class="text-md -translate-y-[1.1rem] text-gray-800 dark:text-gray-100">
								{message.message}
							</h3>
							{#if message.args}
								<p
									class="mb-4 -translate-y-[1.1rem] text-base font-normal text-gray-500 dark:text-gray-400 "
								>
									{message.args}
								</p>
							{/if}
						</li>
					{/if}
					<p />
				{/each}
			</ol>
		{/if}
	</div>
</details>

<style>
	@keyframes grow {
		0% {
			font-size: 0;
			opacity: 0;
		}
		30% {
			font-size: 1em;
			opacity: 0;
		}
		100% {
			opacity: 1;
		}
	}

	.details[open] .content {
		animation-name: grow;
		animation-duration: 300ms;
		animation-delay: 0ms;
	}
</style>
