<script lang="ts">
	import CarbonGeneratePdf from "~icons/carbon/generate-pdf";
	import EosIconsLoading from "~icons/eos-icons/loading";
	let fileList: File[];
	$: fileList = [];

	$: file_error = false;
	$: file_error_message = "";

	export let value = "";
	export let onDrag = false;

	async function handleFileUpload(file: File) {
		// file to blob
		let pdf_blob = new Blob([file], { type: "application/pdf" });

		const formData = new FormData();
		formData.append("file", pdf_blob);

		try {
			const response = await fetch("/convertPdf", {
				method: "POST",
				body: formData,
			});

			if (!response.ok) {
				throw new Error("Failed to convert PDF");
			}

			let { result } = await response.json();
			return result;
		} catch (error) {
			console.error("PDF File conversion error:", error);
			return "";
		}
	}

	async function dropHandle(event: DragEvent) {
		event.preventDefault();

		if (event.dataTransfer && event.dataTransfer.items) {
			// Use DataTransferItemList interface to access the file(s)
			for (let i = 0; i < event.dataTransfer.items.length; i++) {
				// If dropped items aren't files, reject them
				if (event.dataTransfer.items[i].kind === "file") {
					const file = event.dataTransfer.items[i].getAsFile();
					if (file) {
						fileList = [...fileList, file];
						if (event.dataTransfer.items[i].type !== "application/pdf") {
							console.log("Only PDF files are supported");
							file_error = true;
							file_error_message = "Only PDF files are supported";
							break;
						}
						try {
							let mardown_conversion = await handleFileUpload(file);
							value += mardown_conversion;
						} catch (error) {
							file_error = true;
							file_error_message = "Failed to convert PDF: " + error;
							break;
						}
					}
				}
			}
		}

		if (file_error === true) {
			// Sleep for 2 sec
			await new Promise((r) => setTimeout(r, 1000));
		}
		fileList = [];
		onDrag = false;
	}
</script>

<div
	id="dropzone"
	on:drop={dropHandle}
	class="relative flex w-full max-w-4xl flex-col items-center rounded-xl border bg-gray-100 focus-within:border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:focus-within:border-gray-500"
>
	<div class="items-center object-center" />
	<div class="object-center">
		{#if fileList.length === 0}
			<div class="mt-3 flex justify-center">
				<CarbonGeneratePdf class="text-5xl text-gray-500 dark:text-gray-400" />
			</div>
			<p class="mb-3 mt-3 text-sm text-gray-500 dark:text-gray-400">
				Drag and drop your <span class="font-semibold">PDF</span> file here
			</p>
		{:else if file_error === true}
			<p class="mb-3 mt-3 text-sm text-gray-500 dark:text-gray-400">
				Error {file_error_message}
			</p>
		{:else}
			{#each fileList as file}
				<p class="mb-3 mt-3 flex items-center text-sm text-gray-500 dark:text-gray-400">
					<EosIconsLoading class="mr-2 text-3xl" />
					<span class="font-semibold">{file.name}</span>: {file.size} bytes is being converted
				</p>
			{/each}
		{/if}
	</div>
</div>
