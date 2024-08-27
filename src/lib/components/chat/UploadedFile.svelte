<script lang="ts">
	import { createEventDispatcher } from "svelte";
	import { page } from "$app/stores";
	import type { MessageFile } from "$lib/types/Message";
	import CarbonClose from "~icons/carbon/close";
	import CarbonDocumentBlank from "~icons/carbon/document-blank";
	import CarbonDownload from "~icons/carbon/download";

	import Modal from "../Modal.svelte";
	import AudioPlayer from "../players/AudioPlayer.svelte";

	export let file: MessageFile;
	export let canClose = true;
	export let isPreview = false;

	$: showModal = false;
	$: urlNotTrailing = $page.url.pathname.replace(/\/$/, "");

	const dispatch = createEventDispatcher<{ close: void }>();

	function truncateMiddle(text: string, maxLength: number): string {
		if (text.length <= maxLength) {
			return text;
		}

		const halfLength = Math.floor((maxLength - 1) / 2);
		const start = text.substring(0, halfLength);
		const end = text.substring(text.length - halfLength);

		return `${start}…${end}`;
	}

	const isImage = (mime: string) =>
		mime.startsWith("image/") || mime === "webp" || mime === "jpeg" || mime === "png";

	const isAudio = (mime: string) =>
		mime.startsWith("audio/") || mime === "mp3" || mime === "wav" || mime === "x-wav";
	const isVideo = (mime: string) =>
		mime.startsWith("video/") || mime === "mp4" || mime === "x-mpeg";

	$: isClickable = isImage(file.mime) && !isPreview;
</script>

{#if showModal && isClickable}
	<!-- show the image file full screen, click outside to exit -->
	<Modal width="sm:max-w-[500px]" on:close={() => (showModal = false)}>
		{#if file.type === "hash"}
			<img
				src={urlNotTrailing + "/output/" + file.value}
				alt="input from user"
				class="aspect-auto"
			/>
		{:else}
			<!-- handle the case where this is a base64 encoded image -->
			<img
				src={`data:${file.mime};base64,${file.value}`}
				alt="input from user"
				class="aspect-auto"
			/>
		{/if}
	</Modal>
{/if}

<button on:click={() => (showModal = true)} disabled={!isClickable}>
	<div class="group relative flex items-center rounded-xl shadow-sm">
		{#if isImage(file.mime)}
			<div class=" overflow-hidden rounded-xl" class:size-24={isPreview} class:size-48={!isPreview}>
				<img
					src={file.type === "base64"
						? `data:${file.mime};base64,${file.value}`
						: urlNotTrailing + "/output/" + file.value}
					alt={file.name}
					class="h-full w-full bg-gray-200 object-cover dark:bg-gray-800"
				/>
			</div>
		{:else if isAudio(file.mime)}
			<AudioPlayer
				src={file.type === "base64"
					? `data:${file.mime};base64,${file.value}`
					: urlNotTrailing + "/output/" + file.value}
				name={truncateMiddle(file.name, 28)}
			/>
		{:else if isVideo(file.mime)}
			<div
				class="border-1 w-72 overflow-clip rounded-xl border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900"
			>
				<!-- svelte-ignore a11y-media-has-caption -->
				<video
					src={file.type === "base64"
						? `data:${file.mime};base64,${file.value}`
						: urlNotTrailing + "/output/" + file.value}
					controls
				/>
			</div>
		{:else if file.mime === "octet-stream"}
			<div
				class="flex h-14 w-72 items-center gap-2 overflow-hidden rounded-xl border border-gray-200 bg-white p-2 dark:border-gray-800 dark:bg-gray-900"
			>
				<div
					class="grid size-10 flex-none place-items-center rounded-lg bg-gray-100 dark:bg-gray-800"
				>
					<CarbonDocumentBlank class="text-base text-gray-700 dark:text-gray-300" />
				</div>
				<dl class="flex flex-grow flex-col truncate leading-tight">
					<dd class="text-sm">
						{truncateMiddle(file.name, 28)}
					</dd>
					<dt class="text-xs text-gray-400">File type could not be determined</dt>
				</dl>
				<a
					href={file.type === "base64"
						? `data:application/octet-stream;base64,${file.value}`
						: urlNotTrailing + "/output/" + file.value}
					download={file.name}
					class="ml-auto flex-none"
				>
					<CarbonDownload class="text-base text-gray-700 dark:text-gray-300" />
				</a>
			</div>
		{:else}
			<div
				class="flex h-14 w-72 items-center gap-2 overflow-hidden rounded-xl border border-gray-200 bg-white p-2 dark:border-gray-800 dark:bg-gray-900"
			>
				<div
					class="grid size-10 flex-none place-items-center rounded-lg bg-gray-100 dark:bg-gray-800"
				>
					<CarbonDocumentBlank class="text-base text-gray-700 dark:text-gray-300" />
				</div>
				<dl class="flex flex-col truncate leading-tight">
					<dd class="text-sm">
						{truncateMiddle(file.name, 28)}
					</dd>
					<dt class="text-xs text-gray-400">{file.mime}</dt>
				</dl>
			</div>
		{/if}
		<!-- add a button on top that removes the image -->
		{#if canClose}
			<button
				class="invisible absolute -right-2 -top-2 grid size-6 place-items-center rounded-full border bg-black group-hover:visible dark:border-gray-700"
				on:click={() => dispatch("close")}
			>
				<CarbonClose class=" text-xs  text-white" />
			</button>
		{/if}
	</div>
</button>
