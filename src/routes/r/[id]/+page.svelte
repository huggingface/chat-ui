<script lang="ts">
	import ChatWindow from "$lib/components/chat/ChatWindow.svelte";
	import type { PageData } from "./$types";

	export let data: PageData;
</script>

<ChatWindow disabled={true} messages={data.messages} />
