<script lang="ts">
	import { PdfUploadStatus, type PdfUpload } from "$lib/types/PdfChat";
	import { createEventDispatcher, onDestroy } from "svelte";
	import CarbonUpload from "~icons/carbon/upload";
	import CarbonCheckmark from "~icons/carbon/checkmark";

	export let classNames = "";
	export let multimodal = false;
	export let files: File[];
	export let pdfUpload: PdfUpload | undefined = undefined;
	const accept = multimodal ? "image/*,.pdf" : ".pdf";
	const label = multimodal ? "Upload image or PDF" : "Upload PDF";
	let fileInput: HTMLInputElement;
	let interval: ReturnType<typeof setInterval>;

	$: pdfUploading = pdfUpload?.status === PdfUploadStatus.Uploading;
	$: {
		if (pdfUpload?.status === PdfUploadStatus.Uploaded) {
			interval = setInterval(() => {
				if (!pdfUpload) {
					return;
				}
				pdfUpload.status = PdfUploadStatus.Ready;
			}, 1500);
		}
	}

	const dispatch = createEventDispatcher<{
		uploadpdf: File;
	}>();

	function onChange() {
		if (!fileInput.files) {
			return;
		}

		const file = fileInput.files?.[0];
		if (file?.type === "application/pdf") {
			// pdf upload
			dispatch("uploadpdf", file);
		} else if (multimodal && file?.type.startsWith("image")) {
			// image files for multimodal models
			files = Array.from(fileInput.files);
		}
	}

	onDestroy(() => {
		if (interval) {
			clearInterval(interval);
		}
	});
</script>

<button
	class="btn relative h-8 rounded-lg border bg-white px-3 py-1 text-sm text-gray-500 shadow-sm transition-all hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600 {classNames}"
	class:animate-pulse={pdfUploading}
	class:pointer-events-none={pdfUploading || pdfUpload?.status === PdfUploadStatus.Uploaded}
>
	<input
		bind:this={fileInput}
		on:change={onChange}
		class="absolute w-full cursor-pointer opacity-0"
		type="file"
		{accept}
		disabled={pdfUploading}
	/>
	{#if pdfUpload?.status !== PdfUploadStatus.Uploaded}
		<CarbonUpload class="text-xs" />
	{:else}
		<CarbonCheckmark class="text-xs text-green-500" />
	{/if}
	{#if multimodal || !pdfUpload?.name}
		<div class="ml-2">
			{label}
		</div>
	{/if}
</button>
