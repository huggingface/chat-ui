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
		class="relative mt-auto rounded-xl bg-gray-100 text-gray-600 md:px-5 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-300"
	>
		<div class="flex items-center gap-2 p-4 pr-10 pt-10 md:gap-4 md:p-8">
			{#if assistant.avatar}
				<img
					src={`${base}/settings/assistants/${assistant._id.toString()}/avatar?hash=${
						assistant.avatar
					}`}
					alt="avatar"
					class="mr-4 h-12 w-12 rounded-full object-cover md:h-32 md:w-32"
				/>
			{:else}
				<div
					class="mr-4 flex h-12 w-12 items-center justify-center rounded-full bg-gray-300 object-cover text-4xl font-bold uppercase text-gray-500 md:h-32 md:w-32"
				>
					{assistant?.name[0]}
				</div>
			{/if}

			<div class="flex h-full flex-col content-end">
				<p
					class="mb-2 w-fit truncate text-ellipsis rounded-full bg-gray-200 px-4 py-2 text-xs text-gray-600 dark:bg-gray-700 dark:text-gray-400"
				>
					{assistant.modelId}
				</p>
				<p class="text-2xl font-bold">{assistant.name}</p>
				<p class="text-sm text-gray-500 dark:text-gray-400">
					{assistant.description}
				</p>

				<p class="pt-2 text-sm text-gray-400 dark:text-gray-500">
					Created by <a
						class="hover:underline"
						href="https://hf.co/{assistant.createdByName}"
						target="_blank"
					>
						{assistant.createdByName}
					</a>
				</p>
			</div>
		</div>
		<div class="absolute right-2 top-2">
			<a
				href="{base}/settings/assistants/{assistant._id.toString()}"
				class="flex h-7 w-7 items-center justify-center rounded-full border bg-gray-200 p-1 text-xs hover:bg-gray-100 dark:border-gray-500 dark:bg-gray-700 dark:hover:bg-gray-600"
				><IconGear /></a
			>
		</div>
	</div>
	{#if assistant.exampleInputs}
		<div class="mx-auto mt-auto w-full gap-8">
			<div class="md:col-span-2 md:mt-6">
				<div class="grid gap-3 overflow-y-scroll max-md:h-32 md:grid-cols-2 md:gap-5">
					{#each assistant.exampleInputs as example}
						<button
							type="button"
							class="rounded-xl border bg-gray-50 p-2.5 text-left text-gray-600 hover:bg-gray-100 sm:p-4 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
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