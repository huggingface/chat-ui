<script lang="ts">
	import { goto, replaceState } from "$app/navigation";
	import { base } from "$app/paths";
	import { page } from "$app/state";
	import { usePublicConfig } from "$lib/utils/PublicConfig.svelte";

	const publicConfig = usePublicConfig();

	import ChatWindow from "$lib/components/chat/ChatWindow.svelte";
	import { ERROR_MESSAGES, error } from "$lib/stores/errors";
	import { storePendingFiles } from "$lib/utils/pendingFiles";
	import { seedCreatedConversation } from "$lib/utils/pendingConversation";
	import { useSettingsStore } from "$lib/stores/settings.js";
	import { useConversationsStore } from "$lib/stores/conversations.svelte";
	import { findCurrentModel } from "$lib/utils/models";
	import { onDestroy, onMount, tick } from "svelte";
	import { loading } from "$lib/stores/loading.js";
	import { loadAttachmentsFromUrls } from "$lib/utils/loadAttachmentsFromUrls";
	import {
		LINK_PARAM_NAMES,
		linkPromptNeedsConfirmation,
		readLinkPromptRequest,
		type LinkPromptRequest,
	} from "$lib/utils/linkParams";
	import LinkPromptModal from "$lib/components/LinkPromptModal.svelte";
	import { requireAuthUser } from "$lib/utils/auth";
	import { mlAssistant } from "$lib/stores/mlAssistant.svelte";

	let { data } = $props();

	const convsStore = useConversationsStore();

	let hasModels = $derived(Boolean(data.models?.length));
	let files: File[] = $state([]);
	let draft = $state("");
	/** A deep link waiting on the user's say-so; see LinkPromptModal. */
	let linkRequest = $state<LinkPromptRequest | null>(null);

	const settings = useSettingsStore();

	async function createConversation(message: string) {
		const requestedMlAssistant = mlAssistant.enabled;
		try {
			$loading = true;

			// check if $settings.activeModel is a valid model
			// else check if it's an assistant, and use that model
			// else use the first model

			const validModels = data.models.map((model) => model.id);

			let model;
			if (validModels.includes($settings.activeModel)) {
				model = $settings.activeModel;
			} else {
				model = data.models[0].id;
			}
			// The mode runs on its own fixed set; the server enforces this too.
			if (requestedMlAssistant && data.mlAssistantModels.length > 0) {
				model = data.mlAssistantModels.includes(model) ? model : data.mlAssistantModels[0];
			}
			const res = await fetch(`${base}/conversation`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					model,
					preprompt:
						($settings.customPromptsEnabled?.[$settings.activeModel] ?? true)
							? $settings.customPrompts[$settings.activeModel]
							: "",
					mlAssistant: requestedMlAssistant,
				}),
			});

			if (!res.ok) {
				let errorMessage = ERROR_MESSAGES.default;
				try {
					const json = await res.json();
					errorMessage = json.message || errorMessage;
				} catch {
					// Response wasn't JSON (e.g., HTML error page)
					if (res.status === 401) {
						errorMessage = "Authentication required";
					}
				}
				error.set(errorMessage);
				console.error("Error while creating conversation: ", errorMessage);
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
			error.set((err as Error).message || ERROR_MESSAGES.default);
			console.error(err);
		} finally {
			$loading = false;
		}
	}

	onMount(() => {
		try {
			const request = readLinkPromptRequest(page.url.searchParams);
			if (!request) return;
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
		} catch (err) {
			console.error("Failed to process URL parameters:", err);
		}
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

	let currentModel = $derived(findCurrentModel(data.models, data.oldModels, $settings.activeModel));
</script>

<svelte:head>
	<title>{publicConfig.PUBLIC_APP_NAME}</title>
</svelte:head>

{#if hasModels}
	<ChatWindow
		onmessage={(message) => createConversation(message)}
		loading={$loading}
		{currentModel}
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
			onconfirm={() => applyLinkRequest(request)}
			oncancel={() => (linkRequest = null)}
		/>
	{/if}
{:else}
	<div class="mx-auto my-20 max-w-xl rounded-xl border p-6 text-center dark:border-gray-700">
		<h2 class="mb-2 text-xl font-semibold">No models available</h2>
		<p class="text-gray-600 dark:text-gray-300">
			No chat models are configured. Set `OPENAI_BASE_URL` and ensure the server can reach the
			endpoint, then reload. If unset, the app defaults to the Hugging Face router.
		</p>
	</div>
{/if}
