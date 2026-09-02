<script lang="ts">
	import MlAssistantPlanProgress from "./MlAssistantPlanProgress.svelte";
	import { ML_ASSISTANT_TOOLS } from "$lib/constants/mlAssistant";
	import type { MlBudgetSnapshot, MlPlanStep } from "$lib/types/MlAssistant";
	import { formatMicroUsd, MICRO_USD_PER_USD } from "$lib/utils/mlBudget";

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
	}

	let { visible, steps, statusLabel, complete, budget, onbudgetchange }: Props = $props();

	let remainingMicroUsd = $derived(
		budget ? budget.totalMicroUsd - budget.spentMicroUsd - budget.reservedMicroUsd : 0
	);

	/** Matches the server's ceiling on a budget total (PATCH /api/v2/conversations/[id]). */
	const MAX_BUDGET_USD = 10_000;
	/** Room for the widest figure the ceiling allows — "10000.00" — and no more. */
	const maxlength = `${MAX_BUDGET_USD}.00`.length;

	let editingBudget = $state(false);
	let budgetDraft = $state("");

	function openBudgetEditor() {
		if (!budget || !onbudgetchange) return;
		budgetDraft = String(budget.totalMicroUsd / MICRO_USD_PER_USD);
		editingBudget = true;
	}

	/** Digits and at most one two-decimal fraction — money, typed as you'd say it. */
	function sanitizeDraft(raw: string): string {
		const [whole, ...rest] = raw.replace(/[^0-9.]/g, "").split(".");
		return rest.length ? `${whole}.${rest.join("").slice(0, 2)}` : whole;
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
<div class="ml-strip-collapse" class:is-open={visible} inert={!visible}>
	<div
		class="ml-strip flex items-center gap-[9px] border-b border-[#fbe4cc] bg-[#fff4ea] px-4 py-[9px] text-[13.5px] text-[#c2410c] dark:border-[#54371c] dark:bg-[#2b1c0e] dark:text-[#fdba74]"
	>
		<!-- Label text must clear 4.5:1 on the band: #c2410c on #fff4ea is 4.78:1 with
		     little headroom — retint band and text together, not separately. -->
		<span class="flex-none font-semibold">
			ML Intern<span class="sr-only">, mode on</span>
		</span>

		<!-- The plan replaces the tool note, but only once there is a plan to show:
		     a run that has not reported its steps yet would otherwise leave a gap. -->
		{#if steps.length}
			<span class="ml-2 flex min-w-0 items-center">
				<MlAssistantPlanProgress {steps} {statusLabel} {complete} />
			</span>
		{:else}
			<!-- Inherits the strip's color, which is also what the suggestion chips
			     above the composer use — one orange for the whole mode, and dark mode
			     follows without a second literal. -->
			<span class="truncate font-mono text-xs">
				{ML_ASSISTANT_TOOLS.join(" · ")}
			</span>
		{/if}

		<span class="ml-auto"></span>

		{#if budget}
			{#if editingBudget}
				<!-- Shaped like the readout it replaces — same pill, same mono figures,
				     same "$… left" reading — so opening and committing an edit never
				     shifts the strip. A text field on purpose: type=number drags in the
				     UA validation bubble and spinner arrows, neither of which belongs on
				     a one-figure inline edit. -->
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<span
					class="ml-budget-pill flex h-5 flex-none items-center gap-px rounded-full border border-current/30 bg-current/10 pr-2.5 pl-2 font-mono text-xs tabular-nums"
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
						{maxlength}
						style:width={`${Math.max(budgetDraft.length, 1)}ch`}
						class="ml-budget-input min-w-[1ch] border-0 bg-transparent p-0 text-right font-mono text-xs text-current tabular-nums outline-none"
						aria-label="Session budget in dollars, Enter to save"
					/>
					<span class="pl-1 opacity-70">left</span>
				</span>
			{:else}
				<button
					type="button"
					class={[
						// Same height, radius and padding as the editor pill it swaps with,
						// so opening the editor tints a shape that is already there.
						"flex h-5 flex-none items-center rounded-full border border-transparent px-2 font-mono text-xs tabular-nums",
						onbudgetchange
							? "cursor-pointer hover:border-current/20 hover:bg-current/10"
							: "cursor-default",
						remainingMicroUsd <= 0 ? "font-semibold text-red-600 dark:text-red-400" : "",
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
					{formatMicroUsd(remainingMicroUsd)} left
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
		max-height: 56px;
		opacity: 1;
	}

	/* The field itself is chromeless, so focus has to show on the pill around it —
	   and in the strip's own orange (currentColor), not the UA's blue. */
	.ml-budget-pill:focus-within {
		border-color: currentColor;
		box-shadow: 0 0 0 3px color-mix(in srgb, currentColor 18%, transparent);
	}

	@media (prefers-reduced-motion: reduce) {
		.ml-strip-collapse {
			transition: none;
		}
	}
</style>
