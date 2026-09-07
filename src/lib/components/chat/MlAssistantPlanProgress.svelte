<script lang="ts">
	import { Tooltip } from "bits-ui";
	import type { MlPlanStep } from "$lib/types/MlAssistant";

	interface Props {
		steps: MlPlanStep[];
		complete: boolean;
	}

	let { steps, complete }: Props = $props();

	/** Skipped steps are settled, so they count toward the tally the design shows. */
	let settled = $derived(
		steps.filter((step) => step.status === "done" || step.status === "skipped").length
	);

	/**
	 * The design has three step states; the plan has four. `running` has no glyph
	 * of its own (the designer listed one as a follow-up), so it renders as
	 * to-do — reached, not yet settled — and the tally carries the progress.
	 */
	type Glyph = "done" | "skipped" | "todo";
	function glyphFor(step: MlPlanStep): Glyph {
		if (step.status === "done") return "done";
		if (step.status === "skipped") return "skipped";
		return "todo";
	}

	/** A connector takes the colour of the step before it. */
	function connectorSettled(index: number): boolean {
		return glyphFor(steps[index - 1]) !== "todo";
	}

	// Tap opens the tooltip on touch, where hover never fires. One index rather
	// than one flag per step so opening a second closes the first.
	let openStep = $state(-1);

	// The glyphs are decorative and do not clear 4.5:1, so this label is the
	// accessible carrier of each step's name and status.
	function accessibleName(step: MlPlanStep) {
		return `${step.label} — ${step.status}`;
	}
</script>

<div class="flex min-w-0 items-center gap-[14px]">
	<Tooltip.Provider delayDuration={80} disableHoverableContent>
		<div class="flex flex-none items-center">
			{#each steps as step, index (index)}
				{@const glyph = glyphFor(step)}
				{#if index > 0}
					<span
						aria-hidden="true"
						class="h-[1.5px] w-[12px] flex-none {connectorSettled(index)
							? 'bg-[#e8622a]'
							: 'bg-[#e0ddd8] dark:bg-[#333333]'}"
					></span>
				{/if}
				<Tooltip.Root
					open={openStep === index}
					onOpenChange={(open) => (openStep = open ? index : -1)}
					disableCloseOnTriggerClick
				>
					<Tooltip.Trigger
						class="ml-step-hit"
						aria-label={accessibleName(step)}
						onclick={() => (openStep = openStep === index ? -1 : index)}
					>
						{#if glyph === "done"}
							<span
								class="grid size-4 flex-none place-items-center rounded-full bg-[#e8622a]"
								aria-hidden="true"
							>
								<svg
									viewBox="0 0 12 12"
									class="size-[9px]"
									fill="none"
									stroke="#fff"
									stroke-width="2.4"
									stroke-linecap="round"
									stroke-linejoin="round"
								>
									<path d="M2 6.5l2.5 2.5L10 3.5" />
								</svg>
							</span>
						{:else if glyph === "skipped"}
							<span
								class="grid size-4 flex-none place-items-center rounded-full border-[1.5px] border-[#e8622a]"
								aria-hidden="true"
							>
								<span class="h-[1.5px] w-[7px] rounded-[1px] bg-[#e8622a]"></span>
							</span>
						{:else}
							<span
								class="size-4 flex-none rounded-full border-[1.5px] border-[#cfcbc5] dark:border-[#444444]"
								aria-hidden="true"
							></span>
						{/if}
					</Tooltip.Trigger>
					<Tooltip.Portal>
						<Tooltip.Content class="ml-step-tooltip" side="top" sideOffset={10}>
							<span class="font-semibold">{step.label}</span>
							<span> — </span>
							<span class="opacity-65">{step.description}</span>
						</Tooltip.Content>
					</Tooltip.Portal>
				</Tooltip.Root>
			{/each}
		</div>
	</Tooltip.Provider>

	<span
		class={[
			"flex-none text-[13px] leading-none whitespace-nowrap",
			complete
				? "font-semibold text-[#c4511a] dark:text-[#f0a468]"
				: "font-medium text-[#78716c] dark:text-[#a8a29e]",
		]}
		aria-live="polite"
		aria-atomic="true"
	>
		{complete ? "Done" : `${settled} of ${steps.length}`}
	</span>
</div>

<style>
	/* Keeps the 16px glyph's footprint so the row lays out on the designed
	   12px connectors, while giving touch a 44px-tall target. */
	:global(.ml-step-hit) {
		display: grid;
		place-items: center;
		width: 16px;
		height: 44px;
		margin: -14px 0;
		padding: 0;
		border: 0;
		background: transparent;
	}

	:global(.ml-step-hit:focus-visible) {
		outline: 1.5px solid #e8622a;
		outline-offset: -12px;
		border-radius: 8px;
	}

	:global(.ml-step-tooltip) {
		z-index: 50;
		background: #1a1a1f;
		color: #fff;
		padding: 7px 10px;
		border-radius: 7px;
		font-size: 12px;
		font-weight: 400;
		line-height: 1.35;
		white-space: nowrap;
		box-shadow: 0 4px 14px rgba(0, 0, 0, 0.18);
		animation: mlfade 0.12s ease-out;
	}

	@keyframes mlfade {
		from {
			opacity: 0;
			transform: translateY(4px);
		}
		to {
			opacity: 1;
			transform: none;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		:global(.ml-step-tooltip) {
			animation: none;
		}
	}
</style>
