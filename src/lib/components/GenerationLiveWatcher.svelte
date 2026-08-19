<script lang="ts">
	import { browser } from "$app/environment";
	import { base } from "$app/paths";
	import { page } from "$app/state";
	import { onMount } from "svelte";
	import { get } from "svelte/store";
	import { loading } from "$lib/stores/loading";
	import { useConversationsStore } from "$lib/stores/conversations.svelte";
	import { useActiveGenerationsStore } from "$lib/stores/activeGenerations.svelte";
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

	// While a run this tab started is still registering, keep looking this often; its DB
	// record can lag $loading, which won't re-fire to reopen us.
	const REOPEN_WHILE_LOADING_MS = 2_000;

	let source: EventSource | null = null;
	let reopenTimer: ReturnType<typeof setTimeout> | undefined;

	function open() {
		if (!browser || source) return;
		clearTimeout(reopenTimer);
		const es = new EventSource(`${base}/api/v2/generations/live`);
		source = es;

		es.addEventListener("sync", (event) => {
			let payload: { running: RunningEntry[]; ended: EndedEntry[] };
			try {
				payload = JSON.parse((event as MessageEvent).data);
			} catch {
				return;
			}

			activeGenerations.setRunning(payload.running.map((run) => run.conversationId));
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

	onMount(() => {
		// Catch runs already in flight (e.g. started elsewhere before this load).
		open();
		return close;
	});

	// Reopen when a generation starts in this tab, so navigating away keeps it tracked.
	$effect(() => {
		if ($loading) open();
	});
</script>
