<script lang="ts">
	import Modal from "./Modal.svelte";
	import ExternalLinkModal from "./ExternalLinkModal.svelte";
	import { onMount, onDestroy } from "svelte";
	import CarbonClose from "~icons/carbon/close";
	import { pendingChatInput } from "$lib/stores/pendingChatInput";
	import { buildArtifactSrcdoc } from "$lib/utils/previewSrcdoc";
	import { parseExternalUrl } from "$lib/utils/externalLink";
	import type { ArtifactKind } from "$lib/utils/artifacts";

	interface Props {
		html: string;
		/** How to render the content; html also covers raw SVG documents */
		kind?: ArtifactKind;
		onclose?: () => void;
	}

	let { html, kind = "html", onclose }: Props = $props();

	let iframeEl: HTMLIFrameElement | undefined = $state();
	let channel = $state(`preview_${Math.random().toString(36).slice(2)}`);
	let errors: { message: string; stack?: string }[] = $state([]);
	let externalLinkUrl = $state<URL | null>(null);

	let srcdoc = $derived(buildArtifactSrcdoc(kind, html, channel));

	type PreviewMessage = {
		type: string;
		channel: string;
		detail?: { message?: unknown; stack?: string; href?: unknown };
	};

	function onMessage(ev: MessageEvent) {
		if (!iframeEl || ev.source !== iframeEl.contentWindow) return;
		const raw = ev.data as unknown;
		if (!raw || typeof raw !== "object") return;
		const data = raw as Partial<PreviewMessage>;
		if (data.channel !== channel) return;
		if (data.type === "chatui.preview.openLink") {
			// Only honor link messages backed by a real user gesture (clicks inside
			// the iframe propagate activation to ancestor frames); artifact scripts
			// must not be able to pop the confirm without one
			if (navigator.userActivation && !navigator.userActivation.isActive) return;
			// The iframe runs untrusted generated code, so re-validate its href here
			externalLinkUrl = parseExternalUrl(data.detail?.href) ?? null;
			return;
		}
		if (data.type !== "chatui.preview.error") return;
		const detail = (data.detail ?? {}) as { message?: unknown; stack?: string };
		errors = [...errors, { message: String(detail.message ?? "Error"), stack: detail.stack }];
	}

	onMount(() => {
		window.addEventListener("message", onMessage);
	});
	onDestroy(() => {
		window.removeEventListener("message", onMessage);
	});

	function composeText(): string {
		const lines = errors.map((e, i) => `${i + 1}. ${e.message}${e.stack ? `\n${e.stack}` : ""}`);
		const summary = lines[0] ?? "Unknown error";
		return errors.length > 1
			? `it's not working: ${summary} (+${errors.length - 1} more) - can you fix it?`
			: `it's not working: ${summary} - can you fix it?`;
	}

	// Esc/backdrop while the external-link confirm is open dismisses just the
	// confirm; the fullscreen preview itself stays up. (Esc reaches this Modal's
	// handler first because it registered its window listener before the nested
	// confirm modal's.)
	function requestClose() {
		if (externalLinkUrl) {
			externalLinkUrl = null;
			return;
		}
		onclose?.();
	}
</script>

<Modal width="max-w-none max-h-none w-dvw h-dvh rounded-none!" onclose={requestClose}>
	<div class="relative h-dvh w-dvw">
		<iframe
			bind:this={iframeEl}
			title="HTML Preview"
			class="h-full w-full"
			sandbox="allow-scripts"
			referrerpolicy="no-referrer"
			{srcdoc}
		></iframe>

		<!-- Close button with visible container -->
		<button
			class="fixed top-4 right-6 z-50 btn flex h-7 items-center gap-1 rounded-lg border border-gray-500/60 bg-gray-800 px-2 text-xs text-white shadow-xs backdrop-blur-sm transition-none hover:border-gray-500 hover:bg-gray-700 active:shadow-inner"
			title="Close preview (Esc)"
			onclick={() => onclose?.()}
		>
			<CarbonClose class="size-3.5" />
			Close preview
		</button>

		{#if errors.length > 0}
			<button
				class="fixed right-4 bottom-4 z-50 btn flex items-center gap-2 rounded-full border-2 border-red-500/60 bg-red-800/90 px-4 py-1.5 text-sm text-white shadow-lg"
				title="Send error to chat"
				onclick={() => {
					pendingChatInput.set({ text: composeText() });
					onclose?.();
				}}
			>
				<span>Error caught ({errors.length})</span>
			</button>
		{/if}
	</div>
</Modal>

{#if externalLinkUrl}
	<ExternalLinkModal url={externalLinkUrl} onclose={() => (externalLinkUrl = null)} />
{/if}
