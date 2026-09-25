<script lang="ts">
	import { page } from "$app/state";
	import { base } from "$app/paths";
	import { goto, replaceState } from "$app/navigation";
	import { onDestroy, onMount, tick } from "svelte";
	import { usePublicConfig } from "$lib/utils/PublicConfig.svelte";

	import ChatWindow from "$lib/components/chat/ChatWindow.svelte";
	import { findCurrentModel } from "$lib/utils/models";
	import { useSettingsStore } from "$lib/stores/settings";
	import { mlAssistant } from "$lib/stores/mlAssistant.svelte";
	import { useConversationsStore } from "$lib/stores/conversations.svelte";
	import { ERROR_MESSAGES, error } from "$lib/stores/errors";
	import { storePendingFiles } from "$lib/utils/pendingFiles";
	import { seedCreatedConversation } from "$lib/utils/pendingConversation";
	import { loadAttachmentsFromUrls } from "$lib/utils/loadAttachmentsFromUrls";
	import {
		LINK_PARAM_NAMES,
		linkPromptNeedsConfirmation,
		readLinkPromptRequest,
		type LinkPromptRequest,
	} from "$lib/utils/linkParams";
	import LinkPromptModal from "$lib/components/LinkPromptModal.svelte";
	import { requireAuthUser } from "$lib/utils/auth";

	let { data } = $props();

	const convsStore = useConversationsStore();

	let loading = $state(false);
	let files: File[] = $state([]);
	let draft = $state("");

	const settings = useSettingsStore();
	let modelId = $derived(page.params.model ?? "");
	const publicConfig = usePublicConfig();
	let modelPath = $derived(
		modelId
			.split("/")
			.map((segment) => encodeURIComponent(segment))
			.join("/")
	);

	async function createConversation(message: string) {
		const requestedMlAssistant = mlAssistant.enabled;
		try {
			loading = true;

			// The mode runs on its own fixed set; the server enforces this too.
			const model =
				requestedMlAssistant &&
				data.mlAssistantModels.length > 0 &&
				!data.mlAssistantModels.includes(modelId)
					? data.mlAssistantModels[0]
					: modelId;
			const res = await fetch(`${base}/conversation`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					model,
					preprompt:
						($settings.customPromptsEnabled?.[modelId] ?? true)
							? $settings.customPrompts[modelId]
							: "",
					mlAssistant: requestedMlAssistant,
				}),
			});

			if (!res.ok) {
				error.set("Error while creating conversation, try again.");
				console.error("Error while creating conversation: " + (await res.text()));
				return;
			}

			const { conversationId, conversation } = await res.json();
			const createdConversation = seedCreatedConversation(conversationId, conversation);
			const createdInMlMode = createdConversation?.mlAssistant === true;
			if (createdConversation) mlAssistant.confirmCreation(createdInMlMode);

			// Pass the first message text via SvelteKit history state (JSON-serializable).
			// File objects are not serializable, so they are stored in a client-side Map
			// keyed by a random nonce; the nonce travels with the history state and is
			// consumed once by the conversation page.
			const pendingFilesNonce = files.length > 0 ? storePendingFiles(files) : undefined;

			// Optimistically prepend the new conversation to the sidebar immediately so
			// it appears before the first message starts streaming. "New Chat" matches
			// the server-side default title; the real title arrives via a Title stream
			// update once the LLM generates one.
			convsStore.prepend({
				id: conversationId,
				title: "New Chat",
				model: createdConversation?.model ?? model,
				updatedAt: new Date(),
				mlAssistant: createdInMlMode,
			});
			await goto(`${base}/conversation/${conversationId}`, {
				state: { pendingMessage: message, pendingFilesNonce },
			});
		} catch (err) {
			error.set(ERROR_MESSAGES.default);
			console.error(err);
		} finally {
			loading = false;
		}
	}

	/** A deep link waiting on the user's say-so; see LinkPromptModal. */
	let linkRequest = $state<LinkPromptRequest | null>(null);

	onMount(() => {
		try {
			const request = readLinkPromptRequest(page.url.searchParams);
			if (request) {
				// Redirects to login and comes back to this URL, params included.
				if (requireAuthUser()) return;

				// The request lives in memory from here on. Strip it from the URL so a
				// reload or Back/Forward cannot replay it.
				const url = new URL(page.url);
				for (const name of LINK_PARAM_NAMES) url.searchParams.delete(name);
				tick().then(() => {
					replaceState(url, page.state);
				});

				// A link that sends, or one that brings in content we do not publish
				// ourselves, is shown to the user first. Nothing is fetched before then.
				if (linkPromptNeedsConfirmation(request)) {
					linkRequest = request;
				} else {
					void applyLinkRequest(request);
				}
			}
		} catch (err) {
			console.error("Failed to process URL parameters:", err);
		}

		settings.instantSet({ activeModel: modelId });
	});

	// A confirmed request can still be loading attachments when the user moves
	// on. Once this page is gone it must neither attach nor send: a send from
	// here navigates, and would pull the user back into a conversation they
	// never saw being created.
	let unmounted = false;
	onDestroy(() => {
		unmounted = true;
	});

	/** Runs once the user confirmed, or straight away when nothing needed confirming. */
	async function applyLinkRequest(request: LinkPromptRequest) {
		linkRequest = null;
		try {
			if (request.attachmentUrls.length > 0) {
				const result = await loadAttachmentsFromUrls(request.attachmentUrls.map((url) => url.href));
				if (unmounted) return;
				files = result.files;
				if (result.errors.length > 0) {
					console.error("Failed to load some attachments:", result.errors);
					error.set(
						`Failed to load ${result.errors.length} attachment(s). Check console for details.`
					);
				}
			}
			if (request.send && request.prompt) {
				await createConversation(request.prompt);
			} else if (request.prompt && !draft) {
				draft = request.prompt;
			}
		} catch (err) {
			console.error("Failed to process URL parameters:", err);
		}
	}
</script>

<svelte:head>
	<title>{modelId} - {publicConfig.PUBLIC_APP_NAME}</title>
	<meta property="og:title" content="{modelId} - {publicConfig.PUBLIC_APP_NAME}" />
	<meta property="og:type" content="website" />
	<meta property="og:description" content="Use {modelId} with {publicConfig.PUBLIC_APP_NAME}" />
	<meta
		property="og:image"
		content="{publicConfig.PUBLIC_ORIGIN || page.url.origin}{base}/models/{modelPath}/thumbnail.png"
	/>
	<meta property="og:image:alt" content="{modelId} - {publicConfig.PUBLIC_APP_NAME}" />
	<meta property="og:image:width" content="1200" />
	<meta property="og:image:height" content="648" />
	<meta property="og:url" content={page.url.href} />
	<meta property="og:site_name" content={publicConfig.PUBLIC_APP_NAME} />
	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:title" content="{modelId} - {publicConfig.PUBLIC_APP_NAME}" />
	<meta name="twitter:description" content="Use {modelId} with {publicConfig.PUBLIC_APP_NAME}" />
	<meta
		name="twitter:image"
		content="{publicConfig.PUBLIC_ORIGIN || page.url.origin}{base}/models/{modelPath}/thumbnail.png"
	/>
	<meta name="twitter:image:alt" content="{modelId} - {publicConfig.PUBLIC_APP_NAME}" />
</svelte:head>

<ChatWindow
	onmessage={(message) => createConversation(message)}
	{loading}
	currentModel={findCurrentModel(data.models, data.oldModels, modelId)}
	models={data.models}
	bind:files
	bind:draft
/>
<!-- A first visit also opens the layout's welcome modal. One dialog at a time:
     the request waits in memory until that one is dismissed. -->
{#if linkRequest && $settings.welcomeModalSeen}
	{@const request = linkRequest}
	<LinkPromptModal
		{request}
		modelName={modelId}
		onconfirm={() => applyLinkRequest(request)}
		oncancel={() => (linkRequest = null)}
	/>
{/if}
