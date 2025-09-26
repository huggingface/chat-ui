<script lang="ts">
	import { browser } from "$app/environment";
	import { invalidate } from "$app/navigation";

	import {
		type BackgroundGeneration,
		backgroundGenerationEntries,
		removeBackgroundGeneration,
	} from "$lib/stores/backgroundGenerations";
	import { handleResponse, useAPIClient } from "$lib/APIClient";
	import { UrlDependency } from "$lib/types/UrlDependency";
	import { MessageUpdateStatus, MessageUpdateType } from "$lib/types/MessageUpdate";
	import type { Message } from "$lib/types/Message";

	const POLL_INTERVAL_MS = 1000;

	const client = useAPIClient();
	const pollers = new Map<string, () => void>();

	$effect.root(() => {
		if (!browser) {
			pollers.clear();
			return;
		}

		let destroyed = false;

		const stopPoller = (id: string) => {
			const stop = pollers.get(id);
			if (!stop) return;

			stop();
			pollers.delete(id);
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

				const hasFinalAnswer =
					lastAssistant?.updates?.some((update) => update.type === MessageUpdateType.FinalAnswer) ?? false;
				const hasError =
					lastAssistant?.updates?.some(
						(update) =>
							update.type === MessageUpdateType.Status &&
							update.status === MessageUpdateStatus.Error
						)
					?? false;

				if (lastAssistant) {
					await invalidate(UrlDependency.Conversation);
				}

				if (lastAssistant && (hasFinalAnswer || hasError)) {
					removeBackgroundGeneration(id);
					await invalidate(UrlDependency.ConversationList);
				}
			} catch (err) {
				console.error("Background generation poll failed", err);
				removeBackgroundGeneration(id);
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

		$effect(() => {
			const entries = backgroundGenerationEntries;

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

		return () => {
			destroyed = true;
			for (const stop of pollers.values()) stop();
			pollers.clear();
		};
	});
</script>
