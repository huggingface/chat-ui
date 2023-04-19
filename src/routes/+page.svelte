<script lang="ts">
	import { goto, invalidate, invalidateAll } from '$app/navigation';
	import ChatWindow from '$lib/components/chat/ChatWindow.svelte';
	import { pendingMessage } from '$lib/stores/pendingMessage';

	let loading = false;

	async function createConversation(message: string) {
		try {
			loading = true;
			const res = await fetch('/conversation', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				}
			});

			if (!res.ok) {
				alert('Error while creating conversation: ' + (await res.text()));
				return;
			}

			const { conversationId } = await res.json();

			// Ugly hack to use a store as temp storage, feel free to improve ^^
			pendingMessage.set(message);

			// invalidateAll to update list of conversations
			await goto(`/conversation/${conversationId}`, { invalidateAll: true });
		} finally {
			loading = false;
		}
	}
</script>

<ChatWindow on:message={(ev) => createConversation(ev.detail)} disabled={loading} />
