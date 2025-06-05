<script lang="ts">
	import { page } from "$app/state";
	import { base } from "$app/paths";
	import { goto } from "$app/navigation";
	import { onMount } from "svelte";
	import { usePublicConfig } from "$lib/utils/PublicConfig.svelte";

	const publicConfig = usePublicConfig();

	import ChatWindow from "$lib/components/chat/ChatWindow.svelte";
	import { findCurrentModel } from "$lib/utils/models";
	import { useSettingsStore } from "$lib/stores/settings";
	import { ERROR_MESSAGES, error } from "$lib/stores/errors";
	import { pendingMessage } from "$lib/stores/pendingMessage";

	let { data } = $props();

	let loading = $state(false);
	let files: File[] = $state([]);

	const settings = useSettingsStore();
	const modelId = page.params.model;

	async function createConversation(message: string) {
		try {
			loading = true;

			const res = await fetch(`${base}/conversation`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					model: data.assistant.modelId,
					assistantId: data.assistant._id,
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
		settings.instantSet({
			activeModel: modelId,
		});

		const query = page.url.searchParams.get("q");
		if (query) createConversation(query);
	});
</script>

<svelte:head>
	<meta property="og:title" content={data.assistant.name + " - " + publicConfig.PUBLIC_APP_NAME} />
	<meta property="og:type" content="link" />
	<meta
		property="og:description"
		content={`Use the ${data.assistant.name} assistant inside of ${publicConfig.PUBLIC_APP_NAME}`}
	/>
	<meta
		property="og:image"
		content="{publicConfig.PUBLIC_ORIGIN || page.url.origin}{base}/assistant/{data.assistant
			._id}/thumbnail.png"
	/>
	<meta property="og:url" content={page.url.href} />
	<meta name="twitter:card" content="summary_large_image" />
</svelte:head>

<ChatWindow
	on:message={(ev) => createConversation(ev.detail)}
	{loading}
	currentModel={findCurrentModel([...data.models, ...data.oldModels], data.assistant.modelId)}
	assistant={data.assistant}
	models={data.models}
	bind:files
/>
