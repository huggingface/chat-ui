<script lang="ts">
	import { browser } from "$app/environment";
	import { base } from "$app/paths";
	import { page } from "$app/state";
	import { onMount } from "svelte";
	import { get } from "svelte/store";
	import { loading } from "$lib/stores/loading";
	import { useConversationsStore } from "$lib/stores/conversations.svelte";
	import {
		useActiveGenerationsStore,
		type ParkedTurnStatus,
	} from "$lib/stores/activeGenerations.svelte";
	import { useNotificationsStore } from "$lib/stores/notifications.svelte";
	import type { GenerationStatus } from "$lib/types/Generation";

	const convsStore = useConversationsStore();
	const activeGenerations = useActiveGenerationsStore();
	const notifications = useNotificationsStore();

	interface RunningEntry {
		conversationId: string;
		title: string;
	}
	interface EndedEntry {
		conversationId: string;
		title: string;
		status: GenerationStatus;
	}
	interface ParkedEntry {
		conversationId: string;
		status: ParkedTurnStatus;
		/** Epoch ms after which a failed flag stops being shown. */
		expiresAt?: number;
	}

	// While a run this tab started is still registering, keep looking this often; its DB
	// record can lag $loading, which won't re-fire to reopen us.
	const REOPEN_WHILE_LOADING_MS = 2_000;
	const RETRY_MIN_MS = 3_000;
	const RETRY_MAX_MS = 60_000;

	let source: EventSource | null = null;
	let reopenTimer: ReturnType<typeof setTimeout> | undefined;
	let retryDelay = RETRY_MIN_MS;
	let tracking = false;

	function open() {
		if (!browser) return;
		if (source && source.readyState !== EventSource.CLOSED) return;
		clearTimeout(reopenTimer);
		const es = new EventSource(`${base}/api/v2/generations/live`);
		source = es;

		// A failed response (a deploy's 502, a sleep that outlived the socket) closes
		// the source for good, and a dead source blocks every later open(), freezing
		// the sidebar's dots. Retried only while there is something to follow, so a
		// signed-out visitor's 401 is not retried forever.
		es.addEventListener("error", () => {
			if (es.readyState !== EventSource.CLOSED || source !== es) return;
			source = null;
			if (!tracking && !get(loading)) return;
			reopenTimer = setTimeout(open, retryDelay);
			retryDelay = Math.min(retryDelay * 2, RETRY_MAX_MS);
		});

		es.addEventListener("sync", (event) => {
			retryDelay = RETRY_MIN_MS;
			let payload: { running: RunningEntry[]; ended: EndedEntry[]; parked?: ParkedEntry[] };
			try {
				payload = JSON.parse((event as MessageEvent).data);
			} catch {
				return;
			}

			activeGenerations.setRunning(payload.running.map((run) => run.conversationId));
			activeGenerations.setParked(payload.parked ?? []);
			tracking =
				payload.running.length > 0 ||
				(payload.parked ?? []).some((turn) => turn.status !== "failed");
			for (const run of payload.running) {
				if (run.title) convsStore.update(run.conversationId, { title: run.title });
			}
			for (const done of payload.ended) {
				if (done.title) {
					convsStore.update(done.conversationId, { title: done.title, updatedAt: new Date() });
				}
				// The viewed conversation reports its own completion on the page; only toast
				// for one finishing in the background.
				if (done.conversationId !== page.params.id) {
					notifications.push({
						conversationId: done.conversationId,
						title: done.title,
						status: done.status,
					});
				}
			}
		});

		es.addEventListener("idle", onIdle);
	}

	// `idle` means nothing is running: close so we neither hold nor auto-reconnect an idle
	// connection (a plain lifetime-cap close does reconnect). But if this tab has a run
	// starting, keep looking until its record appears rather than stranding it untracked.
	function onIdle() {
		close();
		if (get(loading)) reopenTimer = setTimeout(open, REOPEN_WHILE_LOADING_MS);
	}

	function close() {
		clearTimeout(reopenTimer);
		source?.close();
		source = null;
	}

	// Failed flags expire client-side (see pruneExpired): the feed is closed by
	// the time their window lapses, so only a timer can retire them.
	const PRUNE_INTERVAL_MS = 60_000;

	// Gated like the error handler, or a signed-out tab would 401 on every return.
	function recheck() {
		if (document.visibilityState !== "visible") return;
		if (tracking || get(loading)) open();
	}

	onMount(() => {
		// Catch runs already in flight (e.g. started elsewhere before this load).
		open();
		const pruneTimer = setInterval(() => activeGenerations.pruneExpired(), PRUNE_INTERVAL_MS);
		document.addEventListener("visibilitychange", recheck);
		window.addEventListener("online", recheck);
		return () => {
			clearInterval(pruneTimer);
			document.removeEventListener("visibilitychange", recheck);
			window.removeEventListener("online", recheck);
			close();
		};
	});

	// Reopen when a generation starts in this tab, so navigating away keeps it tracked.
	$effect(() => {
		if ($loading) open();
	});
</script>
