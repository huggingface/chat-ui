<script lang="ts">
	import { goto } from "$app/navigation";
	import { base } from "$app/paths";
	import { page } from "$app/stores";
	import { PUBLIC_APP_DISCLAIMER } from "$env/static/public";
	import ChatWindow from "$lib/components/chat/ChatWindow.svelte";
	import { ERROR_MESSAGES, error } from "$lib/stores/errors";
	import { pendingMessage } from "$lib/stores/pendingMessage";
	import { pendingMessageIdToRetry } from "$lib/stores/pendingMessageIdToRetry";
	import { findCurrentModel } from "$lib/utils/models";
	import { share } from "$lib/utils/share";
	import type { PageData } from "./$types";

	export let data: PageData;

	let loading = false;

	async function createConversation() {
		try {
			loading = true;
			const res = await fetch(`${base}/conversation`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					fromShare: $page.params.id,
					model: data.model,
				}),
			});

			if (!res.ok) {
				error.set("Error while creating conversation, try again.");
				console.error("Error while creating conversation: " + (await res.text()));
				return;
			}

			const { conversationId } = await res.json();

			return conversationId;
		} catch (err) {
			error.set(ERROR_MESSAGES.default);
			console.error(String(err));
			throw err;
		}
	}

	async function shareConversation() {
		const url = `${window.location.origin}${window.location.pathname}`;

		share(url, data.title);
	}
</script>

<svelte:head>
	<title>{data.title}</title>
</svelte:head>

<ChatWindow
	{loading}
	shared={true}
	messages={data.messages}
	searches={data.searches}
	on:message={(ev) =>
		createConversation()
			.then((convId) => {
				$pendingMessage = ev.detail;
				return goto(`${base}/conversation/${convId}`, { invalidateAll: true });
			})
			.finally(() => (loading = false))}
	on:share={shareConversation}
	on:retry={(ev) =>
		createConversation()
			.then((convId) => {
				$pendingMessageIdToRetry = ev.detail.id;
				$pendingMessage = ev.detail.content;
				return goto(`${base}/conversation/${convId}`, { invalidateAll: true });
			})
			.finally(() => (loading = false))}
	models={data.models}
	currentModel={findCurrentModel(data.models, data.model)}
	settings={data.settings}
	loginRequired={!$page.error &&
		(data.requiresLogin
			? !data.user
			: !data.settings.ethicsModalAcceptedAt && !!PUBLIC_APP_DISCLAIMER)}
/>
