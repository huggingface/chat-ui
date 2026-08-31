<script lang="ts">
	import { Switch } from "bits-ui";
	import MlAssistantPlanProgress from "./MlAssistantPlanProgress.svelte";
	import { ML_ASSISTANT_NOTE_OFF, ML_ASSISTANT_TOOLS } from "$lib/constants/mlAssistant";
	import type { MlBudgetSnapshot, MlPlanStep } from "$lib/types/MlAssistant";
	import { formatMicroUsd, MICRO_USD_PER_USD } from "$lib/utils/mlBudget";

	interface Props {
		/** Collapses the strip out of the composer when false, rather than unmounting it. */
		visible: boolean;
		enabled: boolean;
		/** Locks the switch and swaps the tool note for the plan progress row. */
		taskRunning: boolean;
		steps: MlPlanStep[];
		statusLabel: string;
		complete: boolean;
		/** Compute budget ledger; absent means the conversation carries none. */
		budget?: MlBudgetSnapshot;
		ontoggle: (enabled: boolean) => void;
		/** Commits a new budget total in whole USD. Absent makes the readout static. */
		onbudgetchange?: (totalUsd: number) => void;
	}

	let {
		visible,
		enabled,
		taskRunning,
		steps,
		statusLabel,
		complete,
		budget,
		ontoggle,
		onbudgetchange,
	}: Props = $props();

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

<div class="ml-strip-collapse" class:is-open={visible} inert={!visible}>
	<div
		class={[
			"ml-strip flex items-center gap-[9px] border-b px-4 py-[9px] text-[13.5px]",
			// Label text must clear 4.5:1 on the band: #c2410c on #fff4ea is 4.78:1 with
			// little headroom — retint band and text together, not separately.
			enabled
				? "border-[#fbe4cc] bg-[var(--ml-strip-band)] text-[#c2410c] [--ml-strip-band:#fff4ea] dark:border-[#54371c] dark:text-[#fdba74] dark:[--ml-strip-band:#2b1c0e]"
				: "border-[#ececee] bg-transparent text-[#9a9aa0] dark:border-gray-700 dark:text-gray-500",
		]}
	>
		<!-- Once the task is running the mode can no longer be switched off, so the
		     control collapses out of the row and everything after it slides left.
		     The negative margin absorbs the flex gap. -->
		<span class="ml-switch-slot" class:is-collapsed={taskRunning} inert={taskRunning}>
			<Switch.Root
				class="ml-switch"
				checked={enabled}
				disabled={taskRunning}
				onCheckedChange={ontoggle}
				aria-label="ML Intern mode"
			>
				<span class="ml-switch-track" class:is-on={enabled}>
					<Switch.Thumb class="ml-switch-knob" />
				</span>
			</Switch.Root>
		</span>

		<!-- The switch is gone once a task is running, so the title has to be what
		     tells a screen reader the mode is on. -->
		<span class="flex-none" class:font-semibold={enabled}>
			ML Intern{#if taskRunning}<span class="sr-only">, mode on</span>{/if}
		</span>

		<!-- The plan replaces the tool note, but only once there is a plan to show:
		     a run that has not reported its steps yet would otherwise leave a gap. -->
		{#if taskRunning && steps.length}
			<span class="ml-2 flex min-w-0 items-center">
				<MlAssistantPlanProgress {steps} {statusLabel} {complete} />
			</span>
		{:else if enabled}
			<span class="truncate font-mono text-xs text-[#7f8cd8]">
				{ML_ASSISTANT_TOOLS.join(" · ")}
			</span>
		{:else}
			<span class="truncate text-[#c2c2c8] dark:text-gray-600">{ML_ASSISTANT_NOTE_OFF}</span>
		{/if}

		<span class="ml-auto"></span>

		{#if enabled && budget}
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
						class="w-16 rounded border border-current/30 bg-transparent px-1 py-0 text-right text-xs"
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

	.ml-strip {
		transition:
			background 0.35s ease,
			border-color 0.35s ease;
	}

	/* The slot owns the switch's footprint in the row; the button is absolutely
	   positioned over it at 44x44 so the hit target never affects layout. */
	.ml-switch-slot {
		position: relative;
		display: block;
		flex: none;
		width: 26px;
		height: 15px;
		transition:
			width 0.4s cubic-bezier(0.4, 0, 0.2, 1),
			margin-right 0.4s cubic-bezier(0.4, 0, 0.2, 1),
			opacity 0.25s ease;
	}

	.ml-switch-slot.is-collapsed {
		width: 0;
		margin-right: -9px;
		opacity: 0;
		/* Clips the track as it vanishes. Only set while collapsing, so the 44x44
		   hit target is not cut down in the state where it is actually used. */
		overflow: hidden;
	}

	:global(.ml-switch) {
		position: absolute;
		top: -14.5px;
		right: -9px;
		bottom: -14.5px;
		left: -9px;
		display: block;
		padding: 0;
		border: 0;
		background: transparent;
	}

	.ml-switch-track {
		position: absolute;
		top: 14.5px;
		left: 9px;
		width: 26px;
		height: 15px;
		border-radius: 999px;
		overflow: hidden;
		background: #d8d8dd;
		transition: background 0.3s ease;
	}

	.ml-switch-track.is-on {
		background: #ea580c;
	}

	:global(.dark) .ml-switch-track {
		background: #3a3a42;
	}

	:global(.dark) .ml-switch-track.is-on {
		background: #3b5ce0;
	}

	:global(.ml-switch:focus-visible) .ml-switch-track {
		outline: 2px solid #ea580c;
		outline-offset: 2px;
	}

	:global(.ml-switch-knob) {
		position: absolute;
		top: 2px;
		left: 2px;
		display: block;
		width: 11px;
		height: 11px;
		border-radius: 50%;
		background: #fff;
		transition: left 0.28s cubic-bezier(0.4, 0, 0.2, 1);
	}

	:global(.ml-switch-knob[data-state="checked"]) {
		left: 13px;
	}

	@media (prefers-reduced-motion: reduce) {
		.ml-strip-collapse,
		.ml-strip,
		.ml-switch-slot,
		.ml-switch-track,
		:global(.ml-switch-knob) {
			transition: none;
		}
	}
</style>
