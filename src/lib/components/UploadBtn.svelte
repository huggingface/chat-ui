<script lang="ts">
	import { PdfUploadStatus } from "$lib/types/PdfChat";
	import {createEventDispatcher, onDestroy} from "svelte";
	import CarbonUpload from "~icons/carbon/upload";

	export let classNames = "";
	export let multimodal = false;
	export let files: File[];
	export let uploadPdfStatus: PdfUploadStatus;
	
	const accept = multimodal ? "image/*,.pdf" : ".pdf";
	const label = multimodal ? "Upload image or PDF" : "Upload PDF";
	let fileInput: HTMLInputElement;
	let interval: ReturnType<typeof setInterval>;

	$: uploading = uploadPdfStatus === PdfUploadStatus.Uploading;
	$:{
		if(uploadPdfStatus === PdfUploadStatus.Uploaded){
			interval = setInterval(() => {
				uploadPdfStatus = PdfUploadStatus.Ready;
			}, 1500);
		}
	}

	const dispatch = createEventDispatcher<{
		uploadpdf: File;
	}>();

	function onChange() {
		if(!fileInput.files){
			return;
		}
		
		const file = fileInput.files?.[0];
		if (file?.type === "application/pdf") {
			// pdf upload
			dispatch("uploadpdf", file);
		}else{
			// image files for multimodal models
			files = Array.from(fileInput.files);
		}
	}

	onDestroy(() => {
		if(interval){
			clearInterval(interval);
		}
	})
</script>

<button
	class="btn relative h-8 rounded-lg border bg-white px-3 py-1 text-sm text-gray-500 shadow-sm transition-all hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600 {classNames}"
	class:animate-pulse={uploading}
	class:pointer-events-none={uploading}
>
	<input
		bind:this={fileInput}
		on:change={onChange}
		class="absolute w-full cursor-pointer opacity-0"
		type="file"
		{accept}
		disabled={uploading}
	/>
	<CarbonUpload class="mr-2 text-xs " />
	{#if uploadPdfStatus === PdfUploadStatus.Uploaded}
		PDF Uploaded ✅
	{:else if uploading}
		Processing PDF file
	{:else}
		{label}
	{/if}
</button>
