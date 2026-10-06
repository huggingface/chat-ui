<script lang="ts">
	import GenerationLiveWatcher from "../GenerationLiveWatcher.svelte";
	import { createActiveGenerationsStore } from "$lib/stores/activeGenerations.svelte";
	import { createConversationsStore } from "$lib/stores/conversations.svelte";
	import { createNotificationsStore } from "$lib/stores/notifications.svelte";

	interface Props {
		onstore?: (store: ReturnType<typeof createActiveGenerationsStore>) => void;
	}
	let { onstore }: Props = $props();

	// The stores the root layout provides, so the watcher can run on its own.
	const activeGenerations = createActiveGenerationsStore();
	createConversationsStore();
	createNotificationsStore();
	$effect.pre(() => onstore?.(activeGenerations));
</script>

<GenerationLiveWatcher />
