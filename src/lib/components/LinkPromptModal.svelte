<script lang="ts">
	import { browser } from "$app/environment";
	import Modal from "$lib/components/Modal.svelte";
	import { usePublicConfig } from "$lib/utils/PublicConfig.svelte";
	import type { LinkPromptRequest } from "$lib/utils/linkParams";

	import CarbonClose from "~icons/carbon/close";
	import CarbonSendAlt from "~icons/carbon/send-alt";

	interface Props {
		request: LinkPromptRequest;
		/** The model the link picked, when it came through a model route. */
		modelName?: string;
		/** Load the attachments and, for a `q` link, send the prompt. */
		onconfirm: () => void;
		/** Drop the link's prompt and attachments entirely. */
		oncancel: () => void;
	}

	let { request, modelName, onconfirm, oncancel }: Props = $props();

	const publicConfig = usePublicConfig();

	// Only huggingface.co may frame this app (frame-ancestors, svelte.config.js),
	// and the Hub's "Ask HuggingChat" box is what does so. Name the source
	// accordingly. Being framed changes the wording only, never whether we ask:
	// that box also submits a `q` it read from its own page URL on load, so a
	// framed prompt is not proof the user typed it.
	const embedded = browser && window.self !== window.top;
	const source = embedded
		? `the page that opened ${publicConfig.PUBLIC_APP_NAME}`
		: "whoever shared this link";

	const hasAttachments = $derived(request.attachmentUrls.length > 0);
	const subject = $derived(
		request.send
			? hasAttachments
				? "This prompt and its attachments come"
				: "This prompt comes"
			: "These attachments come"
	);

	// Like ExternalLinkModal: this opens without a user gesture, so the confirm
	// button is deliberately not auto-focused. A stray Enter must not send.
</script>

<Modal onclose={oncancel} width="w-[90dvh] md:w-[520px]" labelledBy="link-prompt-title">
	<div class="flex w-full flex-col gap-5 p-6">
		<div class="flex items-start justify-between">
			<h2 id="link-prompt-title" class="text-xl font-semibold text-gray-800 dark:text-gray-200">
				{request.send ? "Send this prompt?" : "Add these attachments?"}
			</h2>
			<button type="button" class="group outline-hidden" onclick={oncancel} aria-label="Close">
				<CarbonClose
					class="size-5 text-gray-700 group-hover:text-gray-500 dark:text-gray-300 dark:group-hover:text-gray-400"
				/>
			</button>
		</div>

		<p class="text-sm text-gray-600 dark:text-gray-400">
			{subject} from {source}. Take a look, and only continue if you trust the source.
			{#if request.send}
				Once sent, the model can act on it with any tools you have connected.
			{/if}
		</p>

		{#if request.prompt}
			<div class="flex flex-col gap-1.5">
				<span class="text-xs font-medium text-gray-500 dark:text-gray-400">
					{request.send ? "Prompt" : "Prompt, placed in the composer without sending"}
				</span>
				<!-- Plain text on purpose: rendered markdown is how a payload hides behind a friendly heading -->
				<pre
					class="scrollbar-custom max-h-48 overflow-y-auto rounded-xl border border-gray-200 bg-gray-50 px-3.5 py-2.5 font-mono text-xs break-words whitespace-pre-wrap text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300">{request.prompt}</pre>
			</div>
		{/if}

		{#if hasAttachments}
			<div class="flex flex-col gap-1.5">
				<span class="text-xs font-medium text-gray-500 dark:text-gray-400">
					{request.attachmentUrls.length === 1 ? "Attachment" : "Attachments"}
				</span>
				<ul class="scrollbar-custom flex max-h-32 flex-col gap-1.5 overflow-y-auto">
					{#each request.attachmentUrls as url (url.href)}
						<!-- Built from URL components (host has no userinfo ambiguity) so the
						     rendered string is byte-identical to the URL that gets fetched -->
						<li
							class="rounded-xl border border-gray-200 bg-gray-50 px-3.5 py-2.5 font-mono text-xs break-all text-gray-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400"
						>
							{url.protocol}//<span class="font-semibold text-gray-800 dark:text-gray-200"
								>{url.host}</span
							>{url.pathname + url.search + url.hash}
						</li>
					{/each}
				</ul>
			</div>
		{/if}

		{#if modelName}
			<p class="text-xs text-gray-500 dark:text-gray-400">
				Model: <span class="font-medium text-gray-700 dark:text-gray-300">{modelName}</span>
			</p>
		{/if}

		<div class="flex items-center justify-end gap-2">
			<button
				type="button"
				class="inline-flex items-center rounded-xl border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-900 shadow-sm outline-hidden hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-700 dark:text-gray-100 dark:hover:bg-gray-600"
				onclick={oncancel}
			>
				Cancel
			</button>
			<button
				type="button"
				class="inline-flex items-center gap-1.5 rounded-xl border border-gray-900 bg-gray-900 px-3 py-1.5 text-sm font-semibold text-white hover:bg-black focus:ring-2 focus:ring-gray-400 focus:ring-offset-2 focus:outline-hidden dark:border-gray-100 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-white dark:focus:ring-offset-gray-800"
				onclick={onconfirm}
			>
				{request.send ? "Send" : "Add attachments"}
				{#if request.send}
					<CarbonSendAlt class="size-3.5" />
				{/if}
			</button>
		</div>
	</div>
</Modal>
