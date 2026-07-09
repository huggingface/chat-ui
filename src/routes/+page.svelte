<script lang="ts">
	import { goto, replaceState } from "$app/navigation";
	import { base } from "$app/paths";
	import { page } from "$app/state";
	import { usePublicConfig } from "$lib/utils/PublicConfig.svelte";

	const publicConfig = usePublicConfig();

	import ChatWindow from "$lib/components/chat/ChatWindow.svelte";
	import { ERROR_MESSAGES, error } from "$lib/stores/errors";
	import { storePendingFiles } from "$lib/utils/pendingFiles";
	import superjson from "superjson";
	import { seedPendingConversation, type ConversationData } from "$lib/utils/pendingConversation";
	import { useSettingsStore } from "$lib/stores/settings.js";
	import { useConversationsStore } from "$lib/stores/conversations.svelte";
	import { findCurrentModel } from "$lib/utils/models";
	import { sanitizeUrlParam, promptFromLinkParams } from "$lib/utils/urlParams";
	import PromptPreviewTags from "$lib/components/PromptPreviewTags.svelte";
	import { onMount, tick } from "svelte";
	import { loading } from "$lib/stores/loading.js";
	import { loadAttachmentsFromUrls } from "$lib/utils/loadAttachmentsFromUrls";
	import { requireAuthUser } from "$lib/utils/auth";

	let { data } = $props();

	const convsStore = useConversationsStore();

	let hasModels = $derived(Boolean(data.models?.length));
	let files: File[] = $state([]);
	let draft = $state("");

	const settings = useSettingsStore();

	async function createConversation(message: string) {
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

			// The create response embeds the conversation payload; hand it to the
			// conversation page as a one-shot seed so its load skips the GET and
			// the first generation request starts one round-trip sooner.
			if (typeof conversation === "string") {
				try {
					seedPendingConversation(conversationId, superjson.parse<ConversationData>(conversation));
				} catch {
					// Malformed seed: the page load falls back to a normal fetch.
				}
			}

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
				model,
				updatedAt: new Date(),
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

	onMount(async () => {
		try {
			// Check if auth is required before processing any query params
			const hasQ = page.url.searchParams.has("q");
			const hasPrompt = page.url.searchParams.has("prompt");
			const hasAttachments = page.url.searchParams.has("attachments");

			if ((hasQ || hasPrompt || hasAttachments) && requireAuthUser()) {
				return; // Redirecting to login, will return to this URL after
			}

			// Handle attachments parameter first
			if (hasAttachments) {
				const result = await loadAttachmentsFromUrls(page.url.searchParams);
				files = result.files;

				// Show errors if any
				if (result.errors.length > 0) {
					console.error("Failed to load some attachments:", result.errors);
					error.set(
						`Failed to load ${result.errors.length} attachment(s). Check console for details.`
					);
				}

				// Clean up URL
				const url = new URL(page.url);
				url.searchParams.delete("attachments");
				history.replaceState({}, "", url);
			}

			const query = sanitizeUrlParam(page.url.searchParams.get("q"));
			if (query) {
				void createConversation(query);
				const url = new URL(page.url);
				url.searchParams.delete("q");
				tick().then(() => {
					replaceState(url, page.state);
				});
				return;
			}

			const promptQuery = sanitizeUrlParam(page.url.searchParams.get("prompt"));
			if (promptQuery && !draft) {
				draft = promptQuery;
				const url = new URL(page.url);
				url.searchParams.delete("prompt");
				tick().then(() => {
					replaceState(url, page.state);
				});
			}
		} catch (err) {
			console.error("Failed to process URL parameters:", err);
		}
	});

	let currentModel = $derived(findCurrentModel(data.models, data.oldModels, $settings.activeModel));

	// Social-preview text for ?q= / ?prompt= deep links. Server-rendered so link
	// unfurlers (which don't run the onMount that consumes these params) see the
	// prompt-specific card; the layout suppresses its generic tags in this case.
	let previewPrompt = $derived(promptFromLinkParams(page.url.searchParams));
</script>

<svelte:head>
	<title>{publicConfig.PUBLIC_APP_NAME}</title>
</svelte:head>

{#if previewPrompt}
	<PromptPreviewTags prompt={previewPrompt} />
{/if}

{#if hasModels}
	<ChatWindow
		onmessage={(message) => createConversation(message)}
		loading={$loading}
		{currentModel}
		models={data.models}
		bind:files
		bind:draft
	/>
{:else}
	<div class="mx-auto my-20 max-w-xl rounded-xl border p-6 text-center dark:border-gray-700">
		<h2 class="mb-2 text-xl font-semibold">No models available</h2>
		<p class="text-gray-600 dark:text-gray-300">
			No chat models are configured. Set `OPENAI_BASE_URL` and ensure the server can reach the
			endpoint, then reload. If unset, the app defaults to the Hugging Face router.
		</p>
	</div>
{/if}
