<script lang="ts">
	import { goto } from "$app/navigation";
	import { base } from "$app/paths";
	import { page } from "$app/stores";
	import type { PageData } from "./$types";
	export let data: PageData;
	let selectedModel = $page.url.searchParams.get("modelId") ?? "";

	const onModelChange = (e: Event) => {
		const newUrl = new URL($page.url);
		if ((e.target as HTMLSelectElement).value === "") {
			newUrl.searchParams.delete("modelId");
		} else {
			newUrl.searchParams.set("modelId", (e.target as HTMLSelectElement).value);
		}
		goto(newUrl);
	};
</script>

<div class="mx-auto w-full max-w-4xl">
	<h1 class="mt-10 w-full text-center text-2xl font-bold">Popular assistants</h1>
	<h3 class="mt-2 w-full text-center text-sm">
		These are the most popular assistants on the platform.
	</h3>

	<label class="mt-10 text-sm">
		Filter by model:
		<select
			class="mx-auto mt-2 rounded-md border border-gray-300 pl-1 text-center text-sm dark:border-gray-700 dark:bg-gray-700"
			bind:value={selectedModel}
			on:change={onModelChange}
		>
			<option value="">All</option>
			{#each data.models as model}
				<option value={model.name}>{model.name}</option>
			{/each}
		</select>
	</label>
	<div class="mt-10 grid w-fit grid-cols-1 gap-4 p-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
		{#each data.assistants as assistant}
			<a
				href="{base}/assistant/{assistant._id}"
				class="flex h-72 flex-col items-center gap-2 rounded-xl border-2 border-gray-300 bg-gray-100 bg-gradient-to-tr from-gray-200 to-gray-50 p-4 transition-all dark:border-gray-700 dark:bg-gray-800 dark:from-gray-900 dark:to-gray-800"
			>
				{#if assistant.avatar}
					<img
						src="{base}/settings/assistants/{assistant._id}/avatar"
						alt="Avatar"
						class="h-24 w-24 rounded-full object-cover"
					/>
				{:else}
					<div
						class="flex h-24 min-h-24 w-24 min-w-24 items-center justify-center rounded-full bg-gray-300 font-bold text-gray-500"
					>
						{assistant.name[0].toLocaleUpperCase()}
					</div>
				{/if}
				<h3 class="text-center text-sm font-semibold">{assistant.name}</h3>
				<span
					class="clip overflow-hidden text-ellipsis text-wrap break-words text-sm text-gray-700 dark:text-gray-300"
					>{assistant.description}</span
				>
				{#if assistant.createdByName}
					<p class="mt-auto pt-2 text-sm text-gray-400 dark:text-gray-500">
						Created by <a
							class="hover:underline"
							href="https://hf.co/{assistant.createdByName}"
							target="_blank"
						>
							{assistant.createdByName}
						</a>
					</p>
				{/if}
			</a>
		{/each}
	</div>
</div>
