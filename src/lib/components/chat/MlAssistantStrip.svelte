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
		/** Commits a new budget total in whole USD. Absent makes the readout static. */
		onbudgetchange?: (totalUsd: number) => void;
	}

	let { visible, steps, statusLabel, complete, budget, onbudgetchange }: Props = $props();

	let remainingMicroUsd = $derived(
		budget ? budget.totalMicroUsd - budget.spentMicroUsd - budget.reservedMicroUsd : 0
	);

	let editingBudget = $state(false);
	let budgetDraft = $state("");

	function openBudgetEditor() {
		if (!budget || !onbudgetchange) return;
		budgetDraft = String(budget.totalMicroUsd / MICRO_USD_PER_USD);
		editingBudget = true;
	}

	function commitBudget() {
		const totalUsd = Number(budgetDraft);
		editingBudget = false;
		if (!Number.isFinite(totalUsd) || totalUsd <= 0) return;
		onbudgetchange?.(totalUsd);
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
			<span class="truncate font-mono text-xs text-[#7f8cd8]">
				{ML_ASSISTANT_TOOLS.join(" · ")}
			</span>
		{/if}

		<span class="ml-auto"></span>

		{#if budget}
			{#if editingBudget}
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<span
					class="flex flex-none items-center gap-1 font-mono text-xs"
					onkeydown={(e) => {
						if (e.key === "Enter") commitBudget();
						if (e.key === "Escape") editingBudget = false;
					}}
				>
					$<input
						use:focusOnMount
						bind:value={budgetDraft}
						onblur={() => (editingBudget = false)}
						type="number"
						min="1"
						max="10000"
						step="1"
						class="ml-budget-input w-16 rounded border border-current/30 bg-transparent px-1 py-0 text-right text-xs"
						aria-label="Session budget in dollars, Enter to save"
					/>
				</span>
			{:else}
				<button
					type="button"
					class={[
						"flex-none font-mono text-xs tabular-nums",
						onbudgetchange ? "cursor-pointer hover:underline" : "cursor-default",
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

	/* Spinner arrows would be the only chrome on the strip's compact money
	   field, and the value is typed, not stepped. */
	.ml-budget-input {
		appearance: textfield;
	}

	.ml-budget-input::-webkit-outer-spin-button,
	.ml-budget-input::-webkit-inner-spin-button {
		appearance: none;
		margin: 0;
	}

	@media (prefers-reduced-motion: reduce) {
		.ml-strip-collapse {
			transition: none;
		}
	}
</style>
