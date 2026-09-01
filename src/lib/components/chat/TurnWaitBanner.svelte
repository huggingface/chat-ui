<script lang="ts">
	import CarbonTime from "~icons/carbon/time";
	import CarbonContinue from "~icons/carbon/continue";
	import { base } from "$app/paths";
	import { serverCorrectedNow } from "$lib/utils/clockSkew.svelte";

	interface Props {
		/** Absolute deadline, epoch ms (server clock). */
		until: number;
		reason?: string;
		/** Cutting the wait short is an action, so it needs the live conversation. */
		conversationId?: string;
		messageId?: string;
		/**
		 * Whether this view may act on the turn: the author's own conversation.
		 * A shared view is routed by share id, which the wake endpoint cannot
		 * resolve, so the control must not appear there at all.
		 */
		canWake?: boolean;
	}

	let { until, reason, conversationId, messageId, canWake = false }: Props = $props();

	// Past the deadline by more than the sweeper's cadence, "counting down" would
	// be a lie — say what is actually happening instead.
	const OVERDUE_GRACE_MS = 15_000;

	let now = $state(serverCorrectedNow());
	$effect(() => {
		const timer = setInterval(() => {
			now = serverCorrectedNow();
		}, 1000);
		return () => clearInterval(timer);
	});

	let remainingMs = $derived(until - now);
	let overdue = $derived(remainingMs < -OVERDUE_GRACE_MS);

	// Stays set once the wake is accepted: the banner is replaced by the resumed
	// turn's own output when the `running` state arrives, so there is nothing to
	// count down to in the meantime.
	let waking = $state(false);
	let wakeError = $state<string | undefined>(undefined);

	let showWakeButton = $derived(
		canWake && Boolean(conversationId && messageId) && !overdue && !waking
	);

	async function wakeNow() {
		if (!conversationId || !messageId || waking) return;
		waking = true;
		wakeError = undefined;
		try {
			const res = await fetch(`${base}/conversation/${conversationId}/wake`, {
				method: "POST",
				// Without Accept, SvelteKit answers `error()` with an HTML page.
				headers: { "Content-Type": "application/json", Accept: "application/json" },
				body: JSON.stringify({ messageId }),
			});
			if (!res.ok) throw new Error(String(res.status));
		} catch {
			// The timer is untouched by a failed request, so the turn still wakes
			// on its own — say so rather than implying the wait is lost.
			waking = false;
			wakeError = "Couldn't check early; still waiting on the timer.";
		}
	}

	function formatRemaining(ms: number): string {
		const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
		const minutes = Math.floor(totalSeconds / 60);
		const seconds = totalSeconds % 60;
		return `${minutes}:${String(seconds).padStart(2, "0")}`;
	}
</script>

<div
	role="status"
	data-exclude-from-copy
	class="mt-2 flex w-fit items-stretch overflow-hidden rounded-lg border border-gray-200 bg-gray-50 text-xs text-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400"
>
	<div class="flex items-center gap-1.5 px-2.5 py-1.5">
		<CarbonTime class="text-[0.8rem] {overdue ? '' : 'animate-pulse'}" />
		{#if overdue}
			<span>Waiting{reason ? ` for ${reason}` : ""} — overdue, waking…</span>
		{:else if waking}
			<span>Waiting{reason ? ` for ${reason}` : ""} — checking now…</span>
		{:else}
			<span>
				Waiting{reason ? ` for ${reason}` : ""} — resumes in
				<span class="font-mono tabular-nums">{formatRemaining(remainingMs)}</span>
			</span>
		{/if}
		{#if wakeError}
			<span class="text-red-500 dark:text-red-400">{wakeError}</span>
		{/if}
	</div>
	{#if showWakeButton}
		<button
			type="button"
			onclick={wakeNow}
			aria-label="Check now"
			title="Check on this now instead of waiting out the timer"
			class="flex cursor-pointer items-center justify-center border-l border-gray-200 px-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:border-gray-700 dark:text-gray-500 dark:hover:bg-gray-700 dark:hover:text-gray-300"
		>
			<CarbonContinue class="text-[0.7rem]" />
		</button>
	{/if}
</div>
