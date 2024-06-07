<script>
	import { createEventDispatcher } from "svelte";
	import CarbonAdd from "~icons/carbon/add-alt";
	export let savedMaskImgs = [];
	let selectedImageId = "";
	let editableLabel = "";
	let editableDescription = "";
	const dispatch = createEventDispatcher();

	function handleImageSelection(event) {
		event.preventDefault();
		selectedImageId = event.target.value;
	}

	$: dispatch("update", {
		id: selectedImageId,
		name: editableLabel,
		description: editableDescription,
	});
</script>

<div class="panel">
	<div class="flex flex-wrap">
		<button
			type="button"
			class={(selectedImageId === ""
				? "border-white bg-emerald-500 text-white"
				: "border-gray-200") +
				" hover:bg- m-4 flex items-center justify-center rounded-lg border px-2 py-2 text-sm shadow-sm transition-all hover:border-gray-300 active:shadow-inner dark:border-gray-600 dark:hover:border-gray-400"}
			on:click={() => {
				selectedImageId = "";
				editableLabel = "";
				editableDescription = "";
			}}
		>
			<CarbonAdd class="mx-2" /> New Annotation
		</button>
		{#each savedMaskImgs as img}
			<button
				type="button"
				class={(selectedImageId === img.id
					? "border-white bg-emerald-500 text-white"
					: "border-gray-200") +
					" hover:bg- m-4 flex items-center justify-center rounded-lg border px-2 py-2 text-sm shadow-sm transition-all hover:border-gray-300 active:shadow-inner dark:border-gray-600 dark:hover:border-gray-400"}
				class:selected={img.id === selectedImageId}
				on:click={() => {
					selectedImageId = img.id;
					editableLabel = img.name;
					editableDescription = img.description;
				}}
			>
				{img.name}
			</button>
		{/each}
	</div>

	<input
		type="text"
		class="resize-none scroll-p-3 overflow-x-hidden overflow-y-scroll border-0 bg-transparent p-3 outline-none focus:ring-0 focus-visible:ring-0"
		bind:value={editableLabel}
		placeholder="Label"
	/>
	<textarea
		class="resize-none scroll-p-3 overflow-x-hidden overflow-y-scroll border-0 bg-transparent p-3 outline-none focus:ring-0 focus-visible:ring-0"
		bind:value={editableDescription}
		placeholder="Description"
	/>
</div>

<style>
	.panel {
		border: #ccc 1px solid;
		border-radius: 10px;
		padding: 15px;
		margin: 10px 0;
	}

	.panel-heading,
	.panel-description,
	select,
	input,
	textarea {
		width: 100%;
		margin-bottom: 10px;
	}

	input,
	textarea {
		padding: 8px;
		border: 1px solid #ccc;
		border-radius: 10px;
	}
</style>
