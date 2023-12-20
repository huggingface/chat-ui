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
		class="relative mt-auto rounded-xl bg-gray-100 text-gray-600 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-300"
	>
		<div class="flex items-center gap-4 p-8">
			{#if assistant.avatar}
				<img
					src={`${base}/settings/assistants/${assistant._id.toString()}/avatar`}
					alt="avatar"
					class="mr-4 h-32 w-32 rounded-full object-cover"
				/>
			{:else}
				<div
					class="mr-4 flex h-32 w-32 items-center justify-center rounded-full bg-gray-300 object-cover text-4xl font-bold text-gray-500"
				>
					{assistant?.name[0].toLocaleUpperCase()}
				</div>
			{/if}

			<div class="flex flex-col">
				<p
					class="mb-4 w-fit rounded-full bg-gray-200 px-4 py-2 text-xs text-gray-600 dark:bg-gray-700 dark:text-gray-400"
				>
					{assistant.modelId}
				</p>
				<p class="text-2xl font-bold">{assistant.name}</p>
				<p class="text-sm text-gray-500 dark:text-gray-400">
					{assistant.description}
				</p>

				<p class="pt-2 text-sm text-gray-400 dark:text-gray-500">
					Created by {assistant.createdByName}
				</p>
			</div>
		</div>
		<a
			href="{base}/settings/assistants/{assistant._id.toString()}"
			class="absolute bottom-4 right-4
            inline text-gray-400 hover:text-gray-600
            dark:text-gray-500 dark:hover:text-gray-400
            "
		>
			<IconGear class="h-6 w-6" />
		</a>
	</div>
	{#if assistant.exampleInputs}
		<div class="mx-auto mt-auto w-full gap-8">
			<div class="lg:col-span-2 lg:mt-6">
				<div class="grid gap-3 lg:grid-cols-2 lg:gap-5">
					{#each assistant.exampleInputs as example}
						<button
							type="button"
							class="rounded-xl border bg-gray-50 p-2.5 text-left text-gray-600 hover:bg-gray-100 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700 sm:p-4"
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
