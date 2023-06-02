<script lang="ts">
	import type { WebSearchMessage } from "$lib/types/WebSearch";
	import CarbonCaretRight from "~icons/carbon/caret-right";

	import CarbonCheckmark from "~icons/carbon/checkmark-filled";
	import CarbonError from "~icons/carbon/error-filled";

	import EosIconsLoading from "~icons/eos-icons/loading";

	import { base } from "$app/paths";
	import { onMount } from "svelte";

	export let loading = false;
	export let classNames = "";
	export let webSearchId: string | undefined;
	export let webSearchMessages: WebSearchMessage[] = [];

	let detailsOpen: boolean;
	let error: boolean;
	onMount(() => {
		if (webSearchMessages.length === 0 && webSearchId) {
			fetch(`${base}/search/${webSearchId}`)
				.then((res) => res.json())
				.then((res) => {
					webSearchMessages = [...res.messages, { type: "result", id: webSearchId }];
				})
				.catch((err) => console.log(err));
		}
	});
	$: error = webSearchMessages.some((message) => message.type === "error");
</script>

<details
	class="details flex w-fit rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900 {classNames}"
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
	<summary
		class="align-center flex cursor-pointer select-none list-none py-1 pl-2.5 pr-2 align-text-top transition-all"
	>
		{#if error}
			<CarbonError class="my-auto text-red-700 dark:text-red-500" />
		{:else if loading}
			<EosIconsLoading class="my-auto text-gray-500" />
		{:else}
			<CarbonCheckmark class="my-auto text-gray-500" />
		{/if}
		<span class="px-2 font-medium" class:text-red-700={error} class:dark:text-red-500={error}
			>Web search
		</span>
		<div class="my-auto transition-all" class:rotate-90={detailsOpen}>
			<CarbonCaretRight />
		</div>
	</summary>

	<div class="content p-5 pb-1">
		{#if webSearchMessages.length === 0}
			<div class="mx-auto w-fit">
				<EosIconsLoading class="mb-3 h-10 w-10" />
			</div>
		{:else}
			<ol class="relative border-l border-gray-200 dark:border-gray-600">
				{#each webSearchMessages as message}
					{#if message.type === "update"}
						<li class="mb-4 ml-4">
							<div
								class="h-3 w-3 -translate-x-[1.4rem] rounded-full bg-gray-200 dark:bg-gray-600"
							/>
							<h3 class="text-md -translate-y-[1.1rem] text-gray-800 dark:text-gray-100">
								{message.message}
							</h3>
							{#if message.args}
								<p
									class="mb-4 -translate-y-[1.1rem]  font-normal text-gray-500 dark:text-gray-400 "
								>
									{message.args}
								</p>
							{/if}
						</li>
					{:else if message.type === "error"}
						<li class="mb-4 ml-4">
							<div
								class="h-3 w-3 -translate-x-[1.4rem] rounded-full text-red-700 dark:text-red-500"
							>
								<CarbonError class="h-3 w-3" />
							</div>
							<h3 class="text-md -translate-y-[1.1rem] text-red-700 dark:text-red-500">
								{message.message}
							</h3>
							{#if message.args}
								<p class="mb-4 -translate-y-[1.1rem] font-normal text-gray-500 dark:text-gray-400 ">
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
