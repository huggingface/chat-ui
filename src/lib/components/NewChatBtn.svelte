<script lang="ts">
	import { goto } from '$app/navigation';

	async function handleNewChat() {
		const response = await fetch('/api/conversations', { method: 'POST' });
		const newConversation = await response.json();

		goto(`?id=${newConversation.id}`);
	}
</script>

<button
	on:click={handleNewChat}
	class="border px-12 py-2.5 rounded-lg shadow bg-white dark:bg-gray-700 dark:border-gray-600"
	>New Chat</button
>
