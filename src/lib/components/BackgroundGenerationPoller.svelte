<script lang="ts">
	import { onDestroy, onMount } from "svelte";
	import { browser } from "$app/environment";
	import { invalidate } from "$app/navigation";

	import { backgroundGenerations, type BackgroundGeneration } from "$lib/stores/backgroundGenerations";
	import { handleResponse, useAPIClient } from "$lib/APIClient";
	import { UrlDependency } from "$lib/types/UrlDependency";
	import { MessageUpdateType } from "$lib/types/MessageUpdate";
	import type { Message } from "$lib/types/Message";

	const POLL_INTERVAL_MS = 2500;

	onMount(() => {
		if (!browser) return;

		const client = useAPIClient();
		const pollers = new Map<string, () => void>();
		let destroyed = false;

		const stopPoller = (id: string) => {
			const stop = pollers.get(id);
			if (stop) {
				stop();
				pollers.delete(id);
			}
		};

		const pollOnce = async (id: string) => {
			if (destroyed) return;
			try {
				const response = await client.conversations({ id }).get();
				const conversation = handleResponse(response);
				const messages = conversation?.messages ?? [];
				const lastAssistant = [...messages]
					.reverse()
					.find((message: Message) => message.from === "assistant");

				const hasFinalAnswer = Boolean(
					lastAssistant?.updates?.some((update) => update.type === MessageUpdateType.FinalAnswer)
				);
				const hasContent = Boolean(lastAssistant?.content?.trim().length);

				if (lastAssistant && (hasFinalAnswer || hasContent)) {
					backgroundGenerations.remove(id);
					await Promise.all([
						invalidate(UrlDependency.Conversation),
						invalidate(UrlDependency.ConversationList),
					]);
				}
			} catch (err) {
				console.error("Background generation poll failed", err);
				backgroundGenerations.remove(id);
			}
		};

		const startPoller = (entry: BackgroundGeneration) => {
			if (pollers.has(entry.id)) return;

			const intervalId = setInterval(() => {
				void pollOnce(entry.id);
			}, POLL_INTERVAL_MS);

			pollers.set(entry.id, () => clearInterval(intervalId));
			void pollOnce(entry.id);
		};

		const unsubscribe = backgroundGenerations.subscribe((entries) => {
			if (destroyed) return;

			const activeIds = new Set(entries.map((entry) => entry.id));

			for (const id of pollers.keys()) {
				if (!activeIds.has(id)) {
					stopPoller(id);
				}
			}

			for (const entry of entries) {
				startPoller(entry);
			}
		});

		onDestroy(() => {
			destroyed = true;
			unsubscribe();
			for (const stop of pollers.values()) stop();
			pollers.clear();
		});
	});
</script>
