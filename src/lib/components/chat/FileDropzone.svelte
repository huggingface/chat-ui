<script lang="ts">
	import CarbonImage from "~icons/carbon/image";
	// import EosIconsLoading from "~icons/eos-icons/loading";

	export let files: File[];

	$: file_error = false;
	$: file_error_message = "";

	export let onDrag = false;

	async function dropHandle(event: DragEvent) {
		event.preventDefault();
		if (event.dataTransfer && event.dataTransfer.items) {
			// Use DataTransferItemList interface to access the file(s)
			for (let i = 0; i < event.dataTransfer.items.length; i++) {
				// If dropped items aren't files, reject them
				if (event.dataTransfer.items[i].kind === "file") {
					const file = event.dataTransfer.items[i].getAsFile();
					if (file) {
						if (!event.dataTransfer.items[i].type.startsWith("image")) {
							file_error = true;
							file_error_message = "Only image files are supported";
							files = [];
							break;
						}
						// if image is bigger than 2MB abort
						if (file.size > 2 * 1024 * 1024) {
							file_error = true;
							file_error_message = "Image is too big. (2MB max)";
							files = [];
							break;
						}
						files = [...files, file];
					}
				}
			}
		}
		if (file_error === true) {
			// Sleep for 2 sec
			await new Promise((r) => setTimeout(r, 1000));
		}
		onDrag = false;
	}
</script>

<div
	id="dropzone"
	role="form"
	on:drop={dropHandle}
	class="relative flex w-full max-w-4xl flex-col items-center rounded-xl border bg-gray-100 focus-within:border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:focus-within:border-gray-500"
>
	<div class="items-center object-center" />
	<div class="object-center">
		{#if file_error}
			<p class="mb-3 mt-3 text-sm text-gray-500 dark:text-gray-400">
				Error {file_error_message}
			</p>
		{:else}
			<div class="mt-3 flex justify-center">
				<CarbonImage class="text-5xl text-gray-500 dark:text-gray-400" />
			</div>
			<p class="mb-3 mt-3 text-sm text-gray-500 dark:text-gray-400">
				Drag and drop your <span class="font-semibold">images</span> here
			</p>
			<!-- {:else}
			{#each fileList as file}
				<p class="mb-3 mt-3 flex items-center text-sm text-gray-500 dark:text-gray-400">
					<EosIconsLoading class="mr-2 text-3xl" />
					<span class="font-semibold">{file.name}</span>: {file.size} bytes is being converted
				</p>
			{/each} -->
		{/if}
	</div>
</div>
