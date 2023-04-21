<script lang="ts">
	import { goto } from "$app/navigation";
	import { base } from "$app/paths";
	import { createConversation } from "$lib/api";
	import ChatWindow from "$lib/components/chat/ChatWindow.svelte";
	import { pendingMessage } from "$lib/stores/pendingMessage";

	let loading = false;

	const handleMessage = async (message: string) => {
		try {
			loading = true;

			const conversationId = await createConversation();

			// Ugly hack to use a store as temp storage, feel free to improve ^^
			pendingMessage.set({ message, conversationId });

			// invalidateAll to update list of conversations
			await goto(`${base}/conversation/${conversationId}`, { invalidateAll: true });
		} catch (e: any) {
			alert("Error while creating conversation: " + e.message);
		} finally {
			loading = false;
		}
	};
</script>

<ChatWindow on:message={(ev) => handleMessage(ev.detail)} {loading} />
