<script lang="ts">
	import { browser, dev } from "$app/environment";
	import { page } from "$app/state";
	import { base } from "$app/paths";
	import { safeInvalidate } from "$lib/utils/safeInvalidate";

	import {
		backgroundGenerationEntries,
		removeBackgroundGeneration,
	} from "$lib/stores/backgroundGenerations";
	import { UrlDependency } from "$lib/types/UrlDependency";
	import { useConversationsStore } from "$lib/stores/conversations.svelte";

	/**
	 * Maximum time a background generation entry is tracked before we give up
	 * and invalidate anyway. Mirrors the old 1Hz poller's MAX_POLL_DURATION_MS.
	 */
	const MAX_TRACK_DURATION_MS = 3 * 60_000;

	/**
	 * How long to wait before reconnecting the SSE stream after it closes
	 * (server-enforced 5-min lifetime causes a normal close; use a brief delay
	 * so we do not hammer the server if there is a transient error).
	 */
	const RECONNECT_DELAY_MS = 1_000;

	const convsStore = useConversationsStore();

	$effect.root(() => {
		if (!browser) return;

		let destroyed = false;
		let eventSource: EventSource | null = null;
		let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

		const log = (...args: unknown[]) => {
			if (dev) console.log("[BackgroundGenerationPoller]", ...args);
		};

		/** Most-recent updatedAt seen across all events; used as reconnect cursor. */
		let latestCursor = new Date(0).toISOString();

		function openStream() {
			if (destroyed || backgroundGenerationEntries.length === 0) return;
			if (eventSource) return; // already open

			const url = new URL(`${base}/api/v2/conversations/updates`, window.location.href);
			url.searchParams.set("cursor", latestCursor);

			log("opening SSE stream, cursor:", latestCursor);
			eventSource = new EventSource(url.toString());

			eventSource.addEventListener("update", (raw) => {
				if (destroyed) return;

				let event: {
					id: string;
					title: string;
					updatedAt: string;
					isTerminal: boolean;
				};
				try {
					event = JSON.parse(raw.data) as typeof event;
				} catch (err) {
					console.error("[BackgroundGenerationPoller] bad SSE payload", err);
					return;
				}

				log("update", event);

				// Advance cursor
				if (event.updatedAt > latestCursor) {
					latestCursor = event.updatedAt;
				}

				// Update sidebar title / updatedAt for this conversation
				convsStore.update(event.id, {
					title: event.title,
					updatedAt: new Date(event.updatedAt),
				});

				const isTracked = backgroundGenerationEntries.some((e) => e.id === event.id);
				if (!isTracked) return;

				if (event.isTerminal) {
					removeBackgroundGeneration(event.id);
					log("complete", event.id);

					// Invalidate the conversation detail if the user is currently viewing it
					void safeInvalidate(UrlDependency.ConversationList).then(() => {
						// Only invalidate the conversation detail when it is currently open
						if (page.params.id === event.id) {
							return safeInvalidate(UrlDependency.Conversation);
						}
					});
				} else {
					// Non-terminal update: if the affected conversation is open, refresh it
					if (page.params.id === event.id) {
						void safeInvalidate(UrlDependency.Conversation);
					}
				}
			});

			eventSource.onerror = () => {
				if (destroyed) return;
				log("SSE error / close — scheduling reconnect");
				closeStream();
				// Reconnect only if there are still entries to track
				if (backgroundGenerationEntries.length > 0) {
					reconnectTimer = setTimeout(() => {
						reconnectTimer = null;
						openStream();
					}, RECONNECT_DELAY_MS);
				}
			};
		}

		function closeStream() {
			if (eventSource) {
				eventSource.close();
				eventSource = null;
				log("SSE stream closed");
			}
		}

		// Timeout guard: entries that have been tracked too long are evicted,
		// mirroring the old poller's MAX_POLL_DURATION_MS behaviour.
		function evictTimedOutEntries() {
			const now = Date.now();
			const timedOut = backgroundGenerationEntries.filter(
				(e) => now - e.startedAt > MAX_TRACK_DURATION_MS
			);
			for (const entry of timedOut) {
				removeBackgroundGeneration(entry.id);
				log("timeout evict", entry.id);
				void safeInvalidate(UrlDependency.ConversationList).then(() => {
					if (page.params.id === entry.id) {
						return safeInvalidate(UrlDependency.Conversation);
					}
				});
			}
		}

		// Evict timed-out entries on an interval even when the SSE stream is quiet.
		const evictTimer = setInterval(evictTimedOutEntries, 10_000);

		$effect(() => {
			// Reactive dep: re-evaluate whenever the entries array changes.
			const hasEntries = backgroundGenerationEntries.length > 0;

			if (destroyed) return;

			if (hasEntries) {
				openStream();
			} else {
				// No active generations — close the stream to conserve connections.
				if (reconnectTimer !== null) {
					clearTimeout(reconnectTimer);
					reconnectTimer = null;
				}
				closeStream();
			}
		});

		return () => {
			destroyed = true;
			clearInterval(evictTimer);
			if (reconnectTimer !== null) clearTimeout(reconnectTimer);
			closeStream();
		};
	});
</script>
