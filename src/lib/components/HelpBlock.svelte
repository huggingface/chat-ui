<script>
	import { onMount } from "svelte";
	import { base } from "$app/paths";
	import CarbonLeft from "~icons/carbon/chevron-left";
	import GenericForm from "./GenericForm.svelte";

	export let jsonData = [];
	let options = [
		{ type: "question", title: "Asking a question" },
		{ type: "training", title: "Training Concept Recognition System" },
	];
	let selectedType = null;
	let menuState = 1;
	let type = "";
	let displayList = [];

	export let message = "";

	onMount(async () => {
		const response = await fetch(`${base}/functions`, {
			method: "GET",
			headers: {
				"Content-Type": "application/json",
			},
		});
		jsonData = await response.json();
		console.log("jsonData", jsonData);
	});
</script>

<div
	class="relative h-full max-h-[200px] w-full overflow-auto rounded-lg border bg-white text-sm text-gray-500 shadow-sm scrollbar-thumb-gray-500 hover:scrollbar-thumb-gray-400 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300 dark:scrollbar-thumb-white/10 dark:hover:scrollbar-thumb-white/20"
>
	{#if menuState === 1}
		{#each options as item}
			<div
				class="w-full px-3 py-3 hover:bg-gray-100 dark:hover:bg-gray-600"
				on:click={() => {
					type = item.type;
					menuState = 2;
					selectedType = item.type;
					displayList = jsonData.filter((x) => x.type === item.type);
				}}
			>
				{item.title}
			</div>
		{/each}
	{:else if jsonData && jsonData.length > 0}
		<div
			class="flex w-full cursor-pointer flex-row items-center justify-start px-3 py-3 hover:bg-gray-100 dark:hover:bg-gray-600"
			on:click={() => {
				menuState = 1;
				selectedType = null;
				displayList = [];
			}}
		>
			<CarbonLeft class="mr-2 text-xxs" />
			Back
		</div>
		{#if selectedType}
			{#each displayList as item}
				<GenericForm
					class="w-full px-3 py-3 hover:bg-gray-100 dark:hover:bg-gray-600"
					sentence={item.title}
					onclick={(msg) => {
						message = msg;
					}}
					image_required={item.image_required}
				/>
			{/each}
		{/if}
	{/if}
</div>
