<script lang="ts">
	// Stands in for ChatWindow where a test drives a route: keeps the route's
	// `files` and `draft` bindings honest without the composer's own traffic.
	let {
		files = $bindable([]),
		draft = $bindable(""),
		onmessage,
	}: { files?: File[]; draft?: string; onmessage?: (content: string) => void } = $props();
</script>

<textarea data-testid="composer" bind:value={draft}></textarea>
<span data-testid="file-count">{files.length}</span>
<button type="button" data-testid="send-message" onclick={() => onmessage?.(draft)}
	>Send message</button
>
