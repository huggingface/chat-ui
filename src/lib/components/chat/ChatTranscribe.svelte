<script lang="ts">
	import { error } from "$lib/stores/errors";
	import CarbonMicrophone from "~icons/carbon/microphone";
	import EosIconsLoading from "~icons/eos-icons/loading";
	import TranscribeWorker from "$lib/workers/transcribeWorker?worker";

	onMount(async () => {
		const { connect } = await import("extendable-media-recorder-wav-encoder");
		const { register } = await import("extendable-media-recorder");

		await register(await connect());
	});

	import type { MediaRecorder as ExtendableMediaRecorder } from "extendable-media-recorder";
	import { onMount } from "svelte";

	export let value = "";

	$: downloading = false;
	$: processing = false;
	$: recording = false;

	$: progress = 0;

	const worker = new TranscribeWorker();
	const userLanguage = navigator.language.slice(0, 2).toLowerCase();

	worker.onmessage = (ev) => {
		if (ev.data.type === "transcription") {
			value += ev.data.transcription;
		} else if (ev.data.type === "progress") {
			progress = ev.data.progress;
		} else if (ev.data.type === "error") {
			error.set(ev.data.error);
		} else if (ev.data.type === "update") {
			if (ev.data.message === "downloading") {
				downloading = true;
			} else if (ev.data.message === "ready") {
				downloading = false;
			}
		}
	};

	let mediaRecorder: InstanceType<typeof ExtendableMediaRecorder> | null = null;

	$: lastWordFromValue = value.split(" ").pop();

	async function onClick() {
		if (mediaRecorder) {
			recording = true;
			mediaRecorder.start();
		} else {
			const { MediaRecorder } = await import("extendable-media-recorder");
			const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
			mediaRecorder = new MediaRecorder(stream, {
				mimeType: "audio/wav",
			});

			mediaRecorder.ondataavailable = (ev) => {
				worker.postMessage({
					type: "audio",
					audioUrl: URL.createObjectURL(ev.data),
					language: userLanguage,
				});
			};

			mediaRecorder.onstop = () => {
				recording = false;
			};

			recording = true;
			mediaRecorder.start();
		}
	}

	$: buttonClasses = [
		...(recording
			? ["text-gray-800", "dark:text-gray-200"]
			: ["text-gray-400", "dark:text-gray-500"]),
		...(downloading ? ["opacity-20"] : []),
	];
</script>

{#if recording}
	<div
		class="bg-gray-800/501 absolute left-0 top-0 z-10 flex h-full w-full items-center justify-center rounded-xl p-2.5"
	>
		<span class="font-bold text-white">{lastWordFromValue}</span>
		<button class="btn" on:click|preventDefault={() => mediaRecorder?.stop()}>Stop</button>
	</div>
{/if}
<div class="absolute right-2 top-2 flex size-7 items-center justify-center">
	<button class="btn relative" on:click|preventDefault={onClick} disabled={downloading}>
		{#if downloading}
			<div class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
				<div class="h-1 w-5 rounded-full bg-gray-200 dark:bg-gray-700">
					<div
						class="h-full rounded-full bg-blue-400 transition-all duration-300 dark:bg-blue-500"
						style="width: {progress * 100}%;"
					/>
				</div>
			</div>
		{/if}
		{#if processing}
			<EosIconsLoading class="size-5" />
		{:else}
			<CarbonMicrophone class={buttonClasses.join(" ")} />
		{/if}
	</button>
</div>
