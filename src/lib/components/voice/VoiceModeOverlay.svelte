<script lang="ts">
	/**
	 * Full-screen voice conversation overlay (ChatGPT-style voice mode).
	 *
	 * Turn loop: listen (VAD) → transcribe → send as a normal conversation
	 * message → watch the assistant reply stream in → synthesize it sentence
	 * by sentence → play → listen again. Messages persist in the conversation
	 * behind the overlay, so closing it leaves a full transcript in the chat.
	 */
	import { onDestroy, onMount, untrack } from "svelte";
	import { base } from "$app/paths";
	import { page } from "$app/state";
	import { PROVIDERS_HUB_ORGS } from "@huggingface/inference";

	import CarbonClose from "~icons/carbon/close";
	import IconMic from "~icons/lucide/mic";
	import IconMicOff from "~icons/lucide/mic-off";

	import type { Message } from "$lib/types/Message";
	import type { Model } from "$lib/types/Model";
	import { MicSession } from "$lib/utils/voice/micSession";
	import { TtsSpeaker } from "$lib/utils/voice/ttsSpeaker";
	import { cleanTextForSpeech, extractSpeakableChunks } from "$lib/utils/voice/sentences";
	import VoiceOrb from "./VoiceOrb.svelte";

	interface Props {
		messages: Message[];
		loading: boolean;
		model: Model;
		onsend: (content: string) => void;
		onstop: () => void;
		onclose: () => void;
	}

	let { messages, loading, model, onsend, onstop, onclose }: Props = $props();

	type Status = "connecting" | "listening" | "transcribing" | "thinking" | "speaking" | "error";

	let status: Status = $state("connecting");
	let muted = $state(false);
	let errorMessage = $state("");
	let lastUserText = $state("");
	let orbLevel = $state(0);

	let voiceChatProvider = $derived(
		(page.data as { voiceChatProvider?: string }).voiceChatProvider ?? "cerebras"
	);
	let providerHubOrg = $derived(
		(PROVIDERS_HUB_ORGS as Record<string, string | undefined>)[voiceChatProvider]
	);

	let mic: MicSession | null = null;
	let speaker: TtsSpeaker | null = null;
	const transcribeAbort = new AbortController();
	let closed = false;

	// Reply tracking: which assistant message this voice turn streams into,
	// how much of it has been handed to TTS, and whether the tail was flushed.
	let sendMarkerId: Message["id"] | null = null;
	let trackedMessageId: Message["id"] | null = null;
	let consumedLength = 0;
	let turnFlushed = false;

	function setStatus(next: Status) {
		if (closed) return;
		status = next;
		mic?.setSensitivity(next === "speaking" ? "guarded" : "normal");
	}

	function fail(message: string) {
		errorMessage = message;
		setStatus("error");
	}

	/** Interrupt the assistant (barge-in or orb tap) and go back to listening. */
	function interrupt() {
		speaker?.stop();
		if (loading) onstop();
		trackedMessageId = null;
		setStatus("listening");
	}

	function maybeFinishTurn() {
		if (status !== "thinking" && status !== "speaking") return;
		if (loading || !turnFlushed || speaker?.isSpeaking) return;
		trackedMessageId = null;
		setStatus("listening");
	}

	async function handleUtterance(audio: Blob | null) {
		if (closed || muted || !audio || audio.size === 0) return;
		if (status !== "listening") return;
		setStatus("transcribing");

		try {
			const response = await fetch(`${base}/api/transcribe`, {
				method: "POST",
				headers: { "Content-Type": audio.type },
				body: audio,
				signal: transcribeAbort.signal,
			});
			if (!response.ok) {
				throw new Error(await response.text());
			}
			const { text } = await response.json();
			const trimmed = (text ?? "").trim();
			if (closed) return;
			if (!trimmed) {
				setStatus("listening");
				return;
			}

			lastUserText = trimmed;
			sendMarkerId = messages.at(-1)?.id ?? null;
			trackedMessageId = null;
			consumedLength = 0;
			turnFlushed = false;
			setStatus("thinking");
			onsend(trimmed);
		} catch (err) {
			if (closed || transcribeAbort.signal.aborted) return;
			console.error("Transcription error:", err);
			setStatus("listening");
		}
	}

	// Watch the assistant reply stream in and feed complete sentences to TTS.
	$effect(() => {
		const currentStatus = status;
		if (currentStatus !== "thinking" && currentStatus !== "speaking") return;
		const isLoading = loading;
		const last = messages.at(-1);
		// Read content in the tracked region: it is mutated in place as tokens
		// stream in, and this effect must re-run on every append.
		const isReply = Boolean(last && last.from === "assistant" && last.id !== sendMarkerId);
		const content = isReply ? (last?.content ?? "") : null;

		untrack(() => {
			if (last && content !== null) {
				if (trackedMessageId !== last.id) {
					trackedMessageId = last.id;
					consumedLength = 0;
				}
				// FinalAnswer may rewrite the text; never re-speak on shrink
				if (content.length >= consumedLength) {
					const { chunks, offset } = extractSpeakableChunks(content, consumedLength, !isLoading);
					consumedLength = offset;
					for (const chunk of chunks) {
						const cleaned = cleanTextForSpeech(chunk);
						if (cleaned) speaker?.enqueue(cleaned);
					}
				}
			}
			if (!isLoading) {
				turnFlushed = true;
				maybeFinishTurn();
			}
		});
	});

	function toggleMute() {
		muted = !muted;
		mic?.setMuted(muted);
	}

	function close() {
		if (closed) return;
		closed = true;
		// Let an in-flight generation finish into the chat; only audio stops.
		transcribeAbort.abort();
		mic?.dispose();
		speaker?.dispose();
		onclose();
	}

	function handleOrbClick() {
		if (status === "speaking" || status === "thinking") {
			interrupt();
		}
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === "Escape") {
			event.preventDefault();
			event.stopPropagation();
			close();
		}
	}

	onMount(() => {
		speaker = new TtsSpeaker(base, {
			onPlaybackStart: () => {
				if (status === "thinking") setStatus("speaking");
			},
			onIdle: () => maybeFinishTurn(),
			onError: () => {
				// Reply text still lands in the chat; keep the loop going.
			},
		});

		mic = new MicSession({
			onSpeechStart: () => {
				if (status === "speaking" || status === "thinking") {
					interrupt();
				}
			},
			onSpeechEnd: (audio) => void handleUtterance(audio),
			onError: (message) => fail(message),
		});

		void mic
			.start()
			.then(() => {
				if (!closed && status === "connecting") setStatus("listening");
			})
			.catch(() => {
				// fail() was already called by onError
			});

		// Drive the orb from whichever side is making sound
		const levelInterval = setInterval(() => {
			orbLevel = status === "speaking" ? (speaker?.level ?? 0) : muted ? 0 : (mic?.level ?? 0);
		}, 50);

		return () => clearInterval(levelInterval);
	});

	onDestroy(close);

	let statusLabel = $derived.by(() => {
		if (muted && status === "listening") return "Muted";
		switch (status) {
			case "connecting":
				return "Connecting…";
			case "listening":
				return "Listening";
			case "transcribing":
				return "Transcribing…";
			case "thinking":
				return "Thinking…";
			case "speaking":
				return "Speaking";
			case "error":
				return errorMessage || "Something went wrong";
		}
	});
</script>

<svelte:window onkeydown={handleKeydown} />

<div
	class="fixed inset-0 z-50 flex flex-col items-center justify-between bg-white/95 backdrop-blur-md dark:bg-gray-900/95"
	role="dialog"
	aria-modal="true"
	aria-label="Voice mode"
>
	<!-- Header: model + provider -->
	<div class="flex w-full items-center justify-center pt-6">
		<div
			class="flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 py-1 text-xs text-gray-500 shadow-xs dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400"
		>
			{#if model.logoUrl}
				<img src={model.logoUrl} alt="" class="size-3.5 rounded-xs" />
			{/if}
			<span class="font-medium text-gray-700 dark:text-gray-200">
				{model.displayName.split("/").pop()}
			</span>
			<span>via</span>
			<span class="flex items-center gap-1 font-mono">
				{#if providerHubOrg}
					<img
						src="https://huggingface.co/api/avatars/{providerHubOrg}"
						alt="{voiceChatProvider} logo"
						class="size-3 rounded-xs"
						onerror={(e) => ((e.currentTarget as HTMLImageElement).style.display = "none")}
					/>
				{/if}
				{voiceChatProvider}
			</span>
		</div>
	</div>

	<!-- Orb + status -->
	<div class="flex flex-1 flex-col items-center justify-center gap-8 px-6">
		<VoiceOrb
			level={orbLevel}
			state={status}
			onclick={handleOrbClick}
			label={status === "speaking" || status === "thinking"
				? "Interrupt the assistant"
				: "Voice orb"}
		/>

		<div class="flex min-h-16 flex-col items-center gap-2 text-center">
			<p
				class={[
					"text-lg font-medium",
					status === "error"
						? "text-red-600 dark:text-red-400"
						: "text-gray-700 dark:text-gray-200",
				]}
				aria-live="polite"
			>
				{statusLabel}
			</p>
			{#if status === "speaking"}
				<p class="text-sm text-gray-400 dark:text-gray-500">Tap the orb to interrupt</p>
			{:else if lastUserText && status === "thinking"}
				<p class="max-w-md text-sm text-gray-400 italic dark:text-gray-500">“{lastUserText}”</p>
			{/if}
		</div>
	</div>

	<!-- Controls -->
	<div class="flex items-center gap-6 pb-10 sm:pb-12">
		<button
			type="button"
			class={[
				"btn grid size-14 place-items-center rounded-full border shadow-sm transition-none",
				muted
					? "border-transparent bg-red-500 text-white hover:bg-red-600"
					: "border-gray-200 bg-white text-gray-700 hover:bg-gray-100 dark:border-transparent dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600",
			]}
			onclick={toggleMute}
			disabled={status === "error"}
			aria-label={muted ? "Unmute microphone" : "Mute microphone"}
			aria-pressed={muted}
		>
			{#if muted}
				<IconMicOff class="size-6" />
			{:else}
				<IconMic class="size-6" />
			{/if}
		</button>

		<button
			type="button"
			class="btn grid size-14 place-items-center rounded-full border border-gray-200 bg-white text-gray-700 shadow-sm transition-none hover:bg-gray-100 dark:border-transparent dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
			onclick={close}
			aria-label="Exit voice mode"
		>
			<CarbonClose class="size-6" />
		</button>
	</div>
</div>
