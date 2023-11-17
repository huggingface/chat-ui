<script lang="ts">
	import type { Message } from "$lib/types/Message";
	import { createEventDispatcher } from "svelte";

	import CarbonSendAltFilled from "~icons/carbon/send-alt-filled";
	import CarbonExport from "~icons/carbon/export";
	import CarbonStopFilledAlt from "~icons/carbon/stop-filled-alt";
	import EosIconsLoading from "~icons/eos-icons/loading";

	import ChatMessages from "./ChatMessages.svelte";
	import ChatInput from "./ChatInput.svelte";
	import StopGeneratingBtn from "../StopGeneratingBtn.svelte";
	import type { Model } from "$lib/types/Model";
	import type { LayoutData } from "../../../routes/$types";
	import WebSearchToggle from "../WebSearchToggle.svelte";
	import LoginModal from "../LoginModal.svelte";
	import type { WebSearchUpdate } from "$lib/types/MessageUpdate";
	import { page } from "$app/stores";
	import DisclaimerModal from "../DisclaimerModal.svelte";
	import RetryBtn from "../RetryBtn.svelte";
	import ImageGallery from "./ImageGallery.svelte";

	export let messages: Message[] = [];
	export let loading = false;
	export let pending = false;
	export let shared = false;
	export let currentModel: Model;
	export let models: Model[];
	export let settings: LayoutData["settings"];
	export let webSearchMessages: WebSearchUpdate[] = [];
	export let preprompt: string | undefined = undefined;
	type Image = {
		id: string;
		url: string;
	};

	$: isReadOnly = !models.some((model) => model.id === currentModel.id);

	let loginModalOpen = false;
	let message: string;
	let fileInput: HTMLInputElement;
	let images: Array<Image> = [];
	let imageGaleryOpened = false;
	async function fetchAllOriginalImages() {
		console.log("fetching images");
		const response = await fetch(`http://127.0.0.1:8000/original_images_list/`, {
			method: "GET",
			headers: {
				accept: "application/json",
			},
		});
		console.log("response", response);

		if (response.ok) {
			const result = await response.json();
			images = result;
		} else {
			console.log("Could not fetch all images URLs");
			images = [];
		}
	}

	const dispatch = createEventDispatcher<{
		message: string;
		share: void;
		stop: void;
		retry: { id: Message["id"]; content: string };
	}>();

	const handleSubmit = () => {
		if (loading) return;
		dispatch("message", message);
		console.log("dispatched message", message);
		message = "";
	};
	$: lastIsError = messages[messages.length - 1]?.from === "user" && !loading;

	// let imageUrl: string | undefined = undefined;

	async function handleFileChange(event: Event) {
		const files = (event.target as HTMLInputElement).files;
		if (!files) return;
		const file = files[0];
		if (file) {
			// Convert the image file to a URL that can be displayed
			// const imageUrl = URL.createObjectURL(file);

			// Prepare the file to be sent in a FormData object
			const formData = new FormData();
			formData.append("file", file);
			console.log("file", file);
			// POST the image file to the server
			const response = await fetch(`http://127.0.0.1:8000/upload/`, {
				method: "POST",
				headers: {
					accept: "application/json",
				},
				body: formData,
			});

			// Handle the response
			console.log("response", response);
			if (response.ok) {
				// Use the returned URL
				const result = await response.json();
				console.log("result", result);
				const json = { id: result.id, url: result.url };
				console.log("json", json);
				if (loading) return;
				dispatch(
					"message",
					`A new image has been added to the image database with the details: ${JSON.stringify(
						result
					)}. Show in "ecole-image" format`
				);
				fetchAllOriginalImages();
			} else {
				console.error("Upload failed", response);
			}
		}
	}
	function onSelectImage(image: Image) {
		dispatch(
			"message",
			`I chose this image: ${JSON.stringify(image)}. Show in "ecole-image" format.
			`
		);
		console.log("dispatched message over here");
	}

	// async function annotateImage() {
	// 	if (!imageUrl) {
	// 		console.error("No image to annotate");
	// 		return;
	// 	}
	// 	const image_id = imageUrl.split("/").pop();
	// 	console.log("image_id", image_id);
	// 	const response = await fetch(`http://localhost:8000/annotate/`, {
	// 		method: "POST",
	// 		body: JSON.stringify({ image_id: "654d7fbc9b4402bd9d1cf1f8", prompt: "Prompt 4" }),
	// 		headers: {
	// 			"Content-Type": "application/json",
	// 		},
	// 	});
	// 	const result = await response.json();
	// 	console.log("result", result);
	// 	console.log("resultoverhere", result);
	// 	if (response.ok) {
	// 		// Use the returned URL
	// 		imageUrl = result.url;
	// 	} else {
	// 		console.error("Upload failed", result);
	// 	}
	// }
	function handleUploadClick(): void {
		fileInput.click();
	}
	function handleImageGaleryClick(): void {
		console.log("clicked");
		imageGaleryOpened = !imageGaleryOpened;
		if (imageGaleryOpened) {
			fetchAllOriginalImages();
		}
	}
</script>

<div class="relative min-h-0 min-w-0">
	{#if !settings.ethicsModalAcceptedAt}
		<DisclaimerModal {settings} />
	{:else if loginModalOpen}
		<LoginModal
			{settings}
			on:close={() => {
				loginModalOpen = false;
			}}
		/>
	{/if}
	<ChatMessages
		{loading}
		{pending}
		{settings}
		{currentModel}
		{models}
		{messages}
		readOnly={isReadOnly}
		isAuthor={!shared}
		{webSearchMessages}
		{preprompt}
		on:message={(ev) => {
			if ($page.data.loginRequired) {
				loginModalOpen = true;
			} else {
				dispatch("message", ev.detail);
			}
		}}
		on:vote
		on:retry={(ev) => {
			console.log(ev);
			if (!loading) dispatch("retry", ev.detail);
		}}
	/>
	<div
		class="dark:via-gray-80 pointer-events-none absolute inset-x-0 bottom-0 z-0 mx-auto flex w-full max-w-3xl flex-col items-center justify-center bg-gradient-to-t from-white via-white/80 to-white/0 px-3.5 py-4 dark:border-gray-800 dark:from-gray-900 dark:to-gray-900/0 max-md:border-t max-md:bg-white max-md:dark:bg-gray-900 sm:px-5 md:py-8 xl:max-w-4xl [&>*]:pointer-events-auto"
	>
		<div class="flex w-full pb-3">
			{#if settings?.searchEnabled}
				<WebSearchToggle />
			{/if}
			{#if loading}
				<StopGeneratingBtn classNames="ml-auto" on:click={() => dispatch("stop")} />
			{/if}
			{#if lastIsError}
				<RetryBtn
					classNames="ml-auto"
					on:click={() =>
						dispatch("retry", {
							id: messages[messages.length - 1].id,
							content: messages[messages.length - 1].content,
						})}
				/>
			{/if}
		</div>
		<!-- <div class="flex flex-1 items-center">
			{#if imageUrl}
				<img class="image-preview" src={imageUrl} alt="Image preview..." />
			{/if}
		</div> -->
		{#if imageGaleryOpened}
			<div class="flex-2 flex items-center">
				<ImageGallery {images} {onSelectImage} />
			</div>
		{/if}
		<div class="flex-2 flex items-center">
			<label for="imageUpload" class="custom-file-upload">
				<input
					type="file"
					bind:this={fileInput}
					id="imageUpload"
					accept="image/*"
					on:change={handleFileChange}
					hidden
				/>
			</label>
			<button
				class="m-4 rounded-lg border border-gray-200 px-2 py-2 text-sm shadow-sm transition-all hover:border-gray-300 active:shadow-inner dark:border-gray-600 dark:hover:border-gray-400"
				on:click={handleUploadClick}
			>
				Upload Image
			</button>
			<button
				class="m-4 rounded-lg border border-gray-200 px-2 py-2 text-sm shadow-sm transition-all hover:border-gray-300 active:shadow-inner dark:border-gray-600 dark:hover:border-gray-400"
				on:click={handleImageGaleryClick}
			>
				{imageGaleryOpened ? "Close" : "Open"} Image Gallery
			</button>
		</div>

		<form
			on:submit|preventDefault={handleSubmit}
			class="relative flex w-full max-w-4xl flex-1 items-center rounded-xl border bg-gray-100 focus-within:border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:focus-within:border-gray-500
			{isReadOnly ? 'opacity-30' : ''}"
		>
			<div class="flex w-full flex-1 border-none bg-transparent">
				{#if lastIsError}
					<ChatInput value="Sorry, something went wrong. Please try again." disabled={true} />
				{:else}
					<ChatInput
						placeholder="Ask anything"
						bind:value={message}
						on:submit={handleSubmit}
						on:keypress={(ev) => {
							if ($page.data.loginRequired) {
								ev.preventDefault();
								loginModalOpen = true;
							}
						}}
						maxRows={4}
						disabled={isReadOnly || lastIsError}
					/>
				{/if}

				{#if loading}
					<button
						class="btn mx-1 my-1 inline-block h-[2.4rem] self-end rounded-lg bg-transparent p-1 px-[0.7rem] text-gray-400 disabled:opacity-60 enabled:hover:text-gray-700 dark:disabled:opacity-40 enabled:dark:hover:text-gray-100 md:hidden"
						on:click={() => dispatch("stop")}
					>
						<CarbonStopFilledAlt />
					</button>
					<div
						class="mx-1 my-1 hidden h-[2.4rem] items-center p-1 px-[0.7rem] text-gray-400 disabled:opacity-60 enabled:hover:text-gray-700 dark:disabled:opacity-40 enabled:dark:hover:text-gray-100 md:flex"
					>
						<EosIconsLoading />
					</div>
				{:else}
					<button
						class="btn mx-1 my-1 h-[2.4rem] self-end rounded-lg bg-transparent p-1 px-[0.7rem] text-gray-400 disabled:opacity-60 enabled:hover:text-gray-700 dark:disabled:opacity-40 enabled:dark:hover:text-gray-100"
						disabled={!message || isReadOnly}
						type="submit"
					>
						<CarbonSendAltFilled />
					</button>
				{/if}
			</div>
		</form>
		<div class="mt-2 flex justify-between self-stretch px-1 text-xs text-gray-400/90 max-sm:gap-2">
			<p>
				Model: <a
					href={currentModel.modelUrl || "https://huggingface.co/" + currentModel.name}
					target="_blank"
					rel="noreferrer"
					class="hover:underline">{currentModel.displayName}</a
				> <span class="max-sm:hidden">·</span><br class="sm:hidden" /> Generated content may be inaccurate
				or false.
			</p>
			{#if messages.length}
				<button
					class="flex flex-none items-center hover:text-gray-400 hover:underline max-sm:rounded-lg max-sm:bg-gray-50 max-sm:px-2.5 dark:max-sm:bg-gray-800"
					type="button"
					on:click={() => dispatch("share")}
				>
					<CarbonExport class="sm:text-primary-500 text-[.6rem] sm:mr-1.5" />
					<div class="max-sm:hidden">Share this conversation</div>
				</button>
			{/if}
		</div>
	</div>
</div>
