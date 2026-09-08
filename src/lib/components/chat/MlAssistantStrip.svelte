<script lang="ts">
	import MlAssistantPlanProgress from "./MlAssistantPlanProgress.svelte";
	import { ML_ASSISTANT_TOOLS } from "$lib/constants/mlAssistant";
	import type { MlBudgetSnapshot, MlPlanStep } from "$lib/types/MlAssistant";
	import { formatMicroUsd, formatMicroUsdCompact, MICRO_USD_PER_USD } from "$lib/utils/mlBudget";
	import IconSparkline from "../icons/IconSparkline.svelte";
	import { trackioStatus } from "$lib/stores/trackioStatus.svelte";
	import { sidePane } from "$lib/stores/sidePane.svelte";
	import type { TrackioDashboard } from "$lib/utils/trackio";

	interface Props {
		/** Collapses the strip out of the composer when false, rather than unmounting it. */
		visible: boolean;
		steps: MlPlanStep[];
		statusLabel: string;
		complete: boolean;
		/** Compute budget ledger; absent means the conversation carries none. */
		budget?: MlBudgetSnapshot;
		/** Commits a new budget total in USD, cents included. Absent makes the readout static. */
		onbudgetchange?: (totalUsd: number) => void;
		/** The run's newest Trackio dashboard, if it has named one. */
		dashboard?: TrackioDashboard;
	}

	let { visible, steps, statusLabel, complete, budget, onbudgetchange, dashboard }: Props =
		$props();

	$effect(() => {
		if (dashboard?.spaceId) trackioStatus.watch(dashboard.url, dashboard.spaceId);
	});

	let dashboardStatus = $derived(
		dashboard?.spaceId ? trackioStatus.status(dashboard.url) : ("live" as const)
	);
	let dashboardLive = $derived(dashboardStatus === "live");

	let remainingMicroUsd = $derived(
		budget ? budget.totalMicroUsd - budget.spentMicroUsd - budget.reservedMicroUsd : 0
	);

	/** Matches the server's ceiling on a budget total (PATCH /api/v2/conversations/[id]). */
	const MAX_BUDGET_USD = 10_000;

	let editingBudget = $state(false);
	let budgetDraft = $state("");

	function openBudgetEditor() {
		if (!budget || !onbudgetchange) return;
		budgetDraft = String(budget.totalMicroUsd / MICRO_USD_PER_USD);
		editingBudget = true;
	}

	/** Room for the widest figure the ceiling allows — "10000.00" — and no more. */
	const MAX_DRAFT_CHARS = `${MAX_BUDGET_USD}.00`.length;

	/**
	 * Digits and at most one two-decimal fraction — money, typed as you'd say it.
	 * The length cap lives here rather than in a maxlength attribute: the UA
	 * truncates a paste before the input event fires, so "ab12.34" would arrive
	 * as "ab12." and lose its cents to the letters.
	 */
	function sanitizeDraft(raw: string): string {
		const [whole, ...rest] = raw.replace(/[^0-9.]/g, "").split(".");
		const clean = rest.length ? `${whole}.${rest.join("").slice(0, 2)}` : whole;
		return clean.slice(0, MAX_DRAFT_CHARS);
	}

	function commitBudget() {
		const draft = budgetDraft.trim();
		const totalUsd = Number(draft);
		editingBudget = false;
		// Zero is a real setting — it pauses spend without discarding the ledger —
		// so only an empty field, a bare ".", or an out-of-range figure abandons.
		if (!draft || !Number.isFinite(totalUsd) || totalUsd < 0 || totalUsd > MAX_BUDGET_USD) return;
		onbudgetchange?.(Math.round(totalUsd * 100) / 100);
	}

	/** The editor exists only while open, so focus belongs to mount. */
	function focusOnMount(node: HTMLElement) {
		node.focus();
	}
</script>

<!-- Status surface only: the strip appears once a task locks the mode onto the
     conversation, and the mode's on/off switch lives in the composer pill
     (MlInternPill.svelte), so the one control here is the budget readout. -->
<div class="ml-strip-collapse @container" class:is-open={visible} inert={!visible}>
	<!-- Orange as ink on a neutral surface: the old peach band was tint-on-tint,
	     which flattened the orange it was carrying. -->
	<div
		class="ml-strip flex h-[44px] items-center gap-[10px] border-b border-[#ececea] bg-white pr-2 pl-[14px] @min-[340px]:gap-[14px] @min-[340px]:pr-[10px] @min-[340px]:pl-[20px] dark:border-[#262626] dark:bg-[#141414]"
	>
		<span class="flex-none">
			<!-- Two spellings, one accessible name: the narrow one is hidden by CSS,
			     not removed, so both would otherwise be read out. -->
			<span aria-hidden="true" class="block size-2 rounded-[2px] bg-[#e8622a] @min-[240px]:hidden"
			></span>
			<span
				aria-hidden="true"
				class="hidden text-[13px] leading-none font-semibold text-[#c4511a] @min-[240px]:inline dark:text-[#f0a468]"
			>
				ML Intern
			</span>
			<span class="sr-only">ML Intern, mode on</span>
		</span>

		<!-- The plan replaces the tool note, but only once there is a plan to show:
		     a run that has not reported its steps yet would otherwise leave a gap. -->
		{#if steps.length}
			<MlAssistantPlanProgress {steps} {statusLabel} {complete} />
		{:else}
			<span class="min-w-0 truncate text-[13px] leading-none text-[#78716c] dark:text-[#a8a29e]">
				{ML_ASSISTANT_TOOLS.join(" · ")}
			</span>
		{/if}

		<span class="ml-auto"></span>

		{#if dashboard}
			<button
				type="button"
				disabled={!dashboardLive}
				class={[
					"ml-control flex flex-none items-center justify-center gap-[6px] px-2 py-[5px]",
					// Below the comfortable width the label goes and the icon keeps a
					// round 28px target, rather than a stub of the pill it was.
					"size-7 rounded-full @min-[480px]:size-auto @min-[480px]:rounded-[6px]",
					"text-[13px] leading-none font-medium text-[#57534e] dark:text-[#a8a29e]",
					dashboardLive
						? "cursor-pointer hover:bg-black/5 hover:text-[#1c1917] dark:hover:bg-white/[.07] dark:hover:text-[#f5f5f4]"
						: "cursor-default opacity-60",
				]}
				title={dashboardLive
					? `Open the training dashboard: ${dashboard.label}`
					: dashboardStatus === "failed"
						? "The training dashboard never came up"
						: "The training dashboard starts with the run"}
				aria-label={dashboardLive
					? `Open the training dashboard: ${dashboard.label}`
					: "Training dashboard, still starting"}
				onclick={() => dashboardLive && sidePane.openTrackio(dashboard.url, dashboard.label)}
			>
				<IconSparkline
					classNames="size-[14px] shrink-0 {dashboardStatus === 'building' ? 'animate-pulse' : ''}"
				/>
				<!-- The one thing this design collapses: below a comfortable width the
				     label goes and the icon keeps a round hit target. -->
				<span class="hidden @min-[480px]:inline">Metrics</span>
			</button>
		{/if}

		{#if budget}
			{#if dashboard}
				<!-- Negative margin pulls its neighbours to 8px, inside the 14px group gap. -->
				<span
					aria-hidden="true"
					class="hidden h-[14px] w-px flex-none bg-[#e5e3df] @min-[340px]:mx-[-6px] @min-[340px]:block dark:bg-[#2e2e2e]"
				></span>
			{/if}
			{#if editingBudget}
				<!-- Shaped like the readout it replaces — same pill, same mono figures,
				     same "$… left" reading — so opening and committing an edit never
				     shifts the strip. A text field on purpose: type=number drags in the
				     UA validation bubble and spinner arrows, neither of which belongs on
				     a one-figure inline edit. -->
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<span
					class="ml-budget-pill flex flex-none items-center gap-px rounded-[6px] px-2 py-[5px] font-mono text-[13px] leading-none font-medium text-[#c4511a] tabular-nums dark:text-[#f0a468]"
					onkeydown={(e) => {
						if (e.key === "Enter") commitBudget();
						if (e.key === "Escape") editingBudget = false;
					}}
				>
					<span aria-hidden="true">$</span>
					<input
						use:focusOnMount
						bind:value={budgetDraft}
						oninput={(e) => (budgetDraft = sanitizeDraft(e.currentTarget.value))}
						onblur={() => (editingBudget = false)}
						type="text"
						inputmode="decimal"
						autocomplete="off"
						style:width={`${Math.max(budgetDraft.length, 1)}ch`}
						class="ml-budget-input min-w-[1ch] border-0 bg-transparent p-0 pb-px text-right font-mono text-[13px] font-medium text-[#1c1917] tabular-nums outline-none dark:text-[#f5f5f4]"
						aria-label="Session budget in dollars, Enter to save"
					/>
					<span class="pl-1 text-[#a8a29e] dark:text-[#78716c]">left</span>
				</span>
			{:else}
				<button
					type="button"
					class={[
						// Same padding and radius as the editor it swaps with, so opening
						// the edit never shifts the strip.
						"ml-control flex flex-none items-center rounded-[6px] px-[6px] py-[5px] @min-[240px]:px-2",
						"font-mono text-[13px] leading-none font-medium tabular-nums",
						remainingMicroUsd <= 0
							? "font-semibold text-red-600 dark:text-red-400"
							: "text-[#c4511a] dark:text-[#f0a468]",
						onbudgetchange
							? "cursor-text hover:bg-black/5 dark:hover:bg-white/[.07]"
							: "cursor-default",
					]}
					onclick={openBudgetEditor}
					title={`Compute budget: ${formatMicroUsd(remainingMicroUsd)} of ${formatMicroUsd(
						budget.totalMicroUsd
					)} remaining (${formatMicroUsd(budget.spentMicroUsd)} spent, ${formatMicroUsd(
						budget.reservedMicroUsd
					)} held by running jobs)${onbudgetchange ? ". Click to change." : ""}`}
					aria-label={`Session budget: ${formatMicroUsd(remainingMicroUsd)} of ${formatMicroUsd(
						budget.totalMicroUsd
					)} remaining${onbudgetchange ? ". Edit budget" : ""}`}
				>
					<span class="@min-[340px]:hidden">{formatMicroUsdCompact(remainingMicroUsd)}</span>
					<span class="hidden @min-[340px]:inline @min-[480px]:hidden"
						>{formatMicroUsd(remainingMicroUsd)}</span
					>
					<span class="hidden @min-[480px]:inline">{formatMicroUsd(remainingMicroUsd)} left</span>
				</button>
			{/if}
		{/if}
	</div>
</div>

<style>
	.ml-strip-collapse {
		max-height: 0;
		opacity: 0;
		/* Also clips the tint to the composer's top corners, so the composer box
		   itself does not need overflow:hidden (which would cut off the paste
		   glow). The radius is the composer's rounded-xl minus its 1px border. */
		overflow: hidden;
		border-top-left-radius: calc(0.75rem - 1px);
		border-top-right-radius: calc(0.75rem - 1px);
		transition:
			max-height 0.45s cubic-bezier(0.4, 0, 0.2, 1),
			opacity 0.3s ease;
	}

	.ml-strip-collapse.is-open {
		max-height: 44px;
		opacity: 1;
	}

	/* One property moves on hover, per the design. */
	:global(.ml-control) {
		transition:
			background-color 120ms ease,
			color 120ms ease;
	}

	/* A 1.5px ring held 2px off the control, in the strip's own background so the
	   gap reads as a gap rather than a second line. */
	:global(.ml-control:focus-visible) {
		outline: none;
		box-shadow:
			0 0 0 2px #fff,
			0 0 0 3.5px #c4511a;
	}

	:global(.dark) :global(.ml-control:focus-visible) {
		box-shadow:
			0 0 0 2px #141414,
			0 0 0 3.5px #f0a468;
	}

	/* The field is chromeless; the underline is what says it is editable. */
	.ml-budget-pill:focus-within :global(.ml-budget-input) {
		border-bottom: 1.5px solid currentColor;
		caret-color: currentColor;
	}

	@media (prefers-reduced-motion: reduce) {
		.ml-strip-collapse {
			transition: none;
		}
	}
</style>
