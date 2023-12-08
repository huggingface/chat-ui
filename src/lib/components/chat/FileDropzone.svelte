<script lang="ts">
	import { onDestroy } from "svelte";
	import CarbonImage from "~icons/carbon/image";
	// import EosIconsLoading from "~icons/eos-icons/loading";

	export let files: File[];

	let file_error_message = "";
	let errorTimeout: ReturnType<typeof setTimeout>;

	export let onDrag = false;

	async function dropHandle(event: DragEvent) {
		event.preventDefault();
		if (event.dataTransfer && event.dataTransfer.items) {
			// Use DataTransferItemList interface to access the file(s)
			if (files.length > 0) {
				files = [];
			}
			// get only the first file
			// optionally: we need to handle multiple files, if we want to support document upload for example
			// for multimodal we only support one image at a time but we could support multiple PDFs
			if (event.dataTransfer.items[0].kind === "file") {
				const file = event.dataTransfer.items[0].getAsFile();
				if (file) {
					if (!event.dataTransfer.items[0].type.startsWith("image")) {
						setErrorMsg("Only images are supported");
						files = [];
						return;
					}
					// if image is bigger than 2MB abort
					if (file.size > 2 * 1024 * 1024) {
						setErrorMsg("Image is too big. (2MB max)");
						files = [];
						return;
					}
					files = [file];
					onDrag = false;
				}
			}
		}
	}

	function setErrorMsg(errorMsg: string) {
		if (errorTimeout) {
			clearTimeout(errorTimeout);
		}
		file_error_message = errorMsg;
		errorTimeout = setTimeout(() => {
			file_error_message = "";
			onDrag = false;
		}, 2000);
	}

	onDestroy(() => {
		if (errorTimeout) {
			clearTimeout(errorTimeout);
		}
	});
</script>

<div
	id="dropzone"
	role="form"
	on:drop={dropHandle}
	class="relative flex w-full max-w-4xl flex-col items-center rounded-xl border border-dashed bg-gray-100 focus-within:border-gray-300 dark:border-gray-500 dark:bg-gray-700 dark:focus-within:border-gray-500"
>
	<div class="object-center">
		{#if file_error_message}
			<div
				class="absolute bottom-0 left-0 right-0 top-0 flex flex-col items-center justify-center gap-2 rounded-xl bg-gray-100 bg-opacity-50 dark:bg-gray-700 dark:bg-opacity-50"
			>
				<p class="text-red-500 dark:text-red-400">{file_error_message}</p>
				<div class="h-2.5 w-1/2 rounded-full bg-gray-200 dark:bg-gray-700">
					<div
						class="animate-progress-bar h-2.5
						rounded-full bg-red-500
						dark:text-red-400
					"
					/>
				</div>
			</div>
		{/if}
		<div class="mt-3 flex justify-center" class:opacity-0={file_error_message}>
			<CarbonImage class="text-xl text-gray-500 dark:text-gray-400" />
		</div>
		<p
			class="mb-3 mt-1.5 text-sm text-gray-500 dark:text-gray-400"
			class:opacity-0={file_error_message}
		>
			Drag and drop <span class="font-semibold">one image</span> here
		</p>
	</div>
</div>

<style>
	@keyframes slideInFromLeft {
		0% {
			width: 0;
		}
		100% {
			width: 100%;
		}
	}

	.animate-progress-bar {
		/* This section calls the slideInFromLeft animation we defined above */
		animation: 2s linear 0s 1 slideInFromLeft;
	}
</style>
