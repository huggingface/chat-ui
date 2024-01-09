<script lang="ts">
	import { PdfUploadStatus, type PdfUpload } from "$lib/types/PdfChat";
	import CarbonDocumentBlank from "~icons/carbon/document-blank";
	import CarbonClose from "~icons/carbon/close";
	import { createEventDispatcher } from "svelte";

	export let pdfUpload: PdfUpload;

	const dispatch = createEventDispatcher<{
		deletepdf: void;
	}>();

	$: uploading = pdfUpload.status === PdfUploadStatus.Uploading;
</script>

<div
	class="max-w-48 group flex items-center gap-x-1"
	class:animate-pulse={uploading}
	class:pointer-events-none={uploading}
	title={pdfUpload.name}
>
	<button
		class="-mr-1 block shrink-0 opacity-70 group-hover:block md:hidden"
		on:click={() => dispatch("deletepdf")}><CarbonClose /></button
	>
	<CarbonDocumentBlank class="shrink-0" />
	<p class="hidden truncate md:block">{pdfUpload.name}</p>
</div>
