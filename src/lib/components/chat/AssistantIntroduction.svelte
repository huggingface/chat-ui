<script lang="ts">
	import { createEventDispatcher } from "svelte";
	import IconGear from "~icons/bi/gear-fill";
	import { base } from "$app/paths";
	import type { Assistant } from "$lib/types/Assistant";

	export let assistant: Pick<
		Assistant,
		"avatar" | "name" | "modelId" | "createdByName" | "exampleInputs" | "_id" | "description"
	>;

	const dispatch = createEventDispatcher<{ message: string }>();
</script>

<div class="flex h-full w-full flex-col content-center items-center justify-center">
	<div
		class="relative mt-auto rounded-2xl bg-gray-100 text-gray-600 dark:border-gray-800 dark:bg-gray-800/60 dark:text-gray-300"
	>
		<div class="flex items-center gap-4 p-4 pr-10 md:p-8 md:pt-10 xl:gap-8">
			{#if assistant.avatar}
				<img
					src={`${base}/settings/assistants/${assistant._id.toString()}/avatar?hash=${
						assistant.avatar
					}`}
					alt="avatar"
					class="size-16 flex-none rounded-full object-cover max-sm:self-start md:size-32"
				/>
			{:else}
				<div
					class="flex size-12 flex-none items-center justify-center rounded-full bg-gray-300 object-cover text-xl font-bold uppercase text-gray-500 max-sm:self-start sm:text-4xl md:size-32 dark:bg-gray-600"
				>
					{assistant?.name[0]}
				</div>
			{/if}

			<div class="flex h-full flex-col gap-2">
				<p
					class="w-fit truncate text-ellipsis rounded-full border bg-white px-3 py-1 text-xs text-gray-800 dark:border-gray-700 dark:bg-gray-700 dark:text-gray-400"
				>
					Assistant
				</p>
				<p class="text-xl font-bold sm:text-2xl">{assistant.name}</p>
				<p class="line-clamp-6 text-balance text-sm text-gray-500 dark:text-gray-400">
					{assistant.description}
				</p>

				{#if assistant.createdByName}
					<p class="pt-2 text-sm text-gray-400 dark:text-gray-500">
						Created by <a
							class="hover:underline"
							href="https://hf.co/{assistant.createdByName}"
							target="_blank"
						>
							{assistant.createdByName}
						</a>
					</p>
				{/if}
			</div>
		</div>
		<div class="absolute right-3 top-3 md:right-4 md:top-4">
			<a
				href="{base}/settings/assistants/{assistant._id.toString()}"
				class="flex size-7 items-center justify-center rounded-full border bg-gray-200 p-1 text-xs hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-700 dark:hover:bg-gray-600"
				><IconGear /></a
			>
		</div>
	</div>
	{#if assistant.exampleInputs}
		<div class="mx-auto mt-auto w-full gap-8 sm:-mb-8">
			<div class="md:col-span-2 md:mt-6">
				<div class="grid grid-cols-1 gap-3 md:grid-cols-2">
					{#each assistant.exampleInputs as example}
						<button
							type="button"
							class="truncate whitespace-nowrap rounded-xl border bg-gray-50 px-3 py-2 text-left text-smd text-gray-600 hover:bg-gray-100 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
							on:click={() => dispatch("message", example)}
						>
							{example}
						</button>
					{/each}
				</div>
			</div>
		</div>
	{/if}
</div>
