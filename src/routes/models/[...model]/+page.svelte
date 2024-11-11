<script lang="ts">
	import { page } from "$app/stores";
	import { base } from "$app/paths";
	import { goto } from "$app/navigation";
	import { onMount } from "svelte";
	import { env as envPublic } from "$env/dynamic/public";
	import ChatWindow from "$lib/components/chat/ChatWindow.svelte";
	import { findCurrentModel } from "$lib/utils/models";
	import { useSettingsStore } from "$lib/stores/settings";
	import { ERROR_MESSAGES, error } from "$lib/stores/errors";
	import { pendingMessage } from "$lib/stores/pendingMessage";

	export let data;

	let loading = false;
	let files: File[] = [];

	const settings = useSettingsStore();
	const modelId = $page.params.model;

	async function createConversation(message: string) {
		try {
			loading = true;

			const res = await fetch(`${base}/conversation`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					model: modelId,
					preprompt: $settings.customPrompts[modelId],
				}),
			});

			if (!res.ok) {
				error.set("Error while creating conversation, try again.");
				console.error("Error while creating conversation: " + (await res.text()));
				return;
			}

			const { conversationId } = await res.json();

			// Ugly hack to use a store as temp storage, feel free to improve ^^
			pendingMessage.set({
				content: message,
				files,
			});

			// invalidateAll to update list of conversations
			await goto(`${base}/conversation/${conversationId}`, { invalidateAll: true });
		} catch (err) {
			error.set(ERROR_MESSAGES.default);
			console.error(err);
		} finally {
			loading = false;
		}
	}

	onMount(async () => {
		const query = $page.url.searchParams.get("q");
		if (query) createConversation(query);

		settings.instantSet({ activeModel: modelId });
	});
</script>

<svelte:head>
	<meta property="og:title" content={modelId + " - " + envPublic.PUBLIC_APP_NAME} />
	<meta property="og:type" content="link" />
	<meta property="og:description" content={`Use ${modelId} with ${envPublic.PUBLIC_APP_NAME}`} />
	<meta
		property="og:image"
		content="{envPublic.PUBLIC_ORIGIN || $page.url.origin}{base}/models/{modelId}/thumbnail.png"
	/>
	<meta property="og:url" content={$page.url.href} />
	<meta name="twitter:card" content="summary_large_image" />
</svelte:head>

<ChatWindow
	on:message={(ev) => createConversation(ev.detail)}
	{loading}
	currentModel={findCurrentModel([...data.models, ...data.oldModels], modelId)}
	models={data.models}
	bind:files
/>
