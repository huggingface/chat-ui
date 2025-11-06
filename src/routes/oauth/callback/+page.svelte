<script lang="ts">
	import { onMount } from "svelte";
	import { onMcpAuthorization } from "$lib/mcp/auth/callback";

	onMount(() => {
		onMcpAuthorization();
	});
</script>

<div class="p-6 text-sm text-gray-600 dark:text-gray-300">
	Completing authentication… you can close this window. If this message persists, you may close the
	window manually.
	<noscript>JavaScript is required to complete authentication.</noscript>
</div>
