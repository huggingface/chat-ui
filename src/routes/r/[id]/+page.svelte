<script lang="ts">
	import { goto } from "$app/navigation";
	import { base } from "$app/paths";
	import { page } from "$app/stores";
	import ChatWindow from "$lib/components/chat/ChatWindow.svelte";
	import { pendingMessage } from "$lib/stores/pendingMessage";
	import type { PageData } from "./$types";

	export let data: PageData;

	let loading = false;

	async function createConversation(message: string) {
		try {
			loading = true;
			const res = await fetch(`${base}/conversation`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					fromShare: $page.params.id,
				}),
			});

			if (!res.ok) {
				alert("Error while creating conversation: " + (await res.text()));
				return;
			}

			const { conversationId } = await res.json();

			// Ugly hack to use a store as temp storage, feel free to improve ^^
			pendingMessage.set(message);

			// invalidateAll to update list of conversations
			await goto(`${base}/conversation/${conversationId}`, { invalidateAll: true });
		} finally {
			loading = false;
		}
	}

	async function shareConversation() {
		const url = `${window.location.origin}${window.location.pathname}`;

		if (navigator.share) {
			navigator.share({
				title: data.title,
				text: "Share this chat with others",
				url,
			});
		} else {
			prompt("Share this link with your friends:", url);
		}
	}
</script>

<ChatWindow
	on:message={(ev) => createConversation(ev.detail)}
	on:share={shareConversation}
	messages={data.messages}
	{loading}
/>
