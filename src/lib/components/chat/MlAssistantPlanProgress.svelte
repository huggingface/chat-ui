<script lang="ts">
	import { Tooltip } from "bits-ui";
	import type { MlPlanStep } from "$lib/types/MlAssistant";

	interface Props {
		steps: MlPlanStep[];
		/** Present-tense label for the running step; empty when none is running. */
		statusLabel: string;
		complete: boolean;
	}

	let { steps, statusLabel, complete }: Props = $props();

	// The design's "Step 3 of 5" is placeholder copy: the slot carries the running
	// step's own label. Its type and colour are the design's.
	let statusText = $derived(complete ? "Done" : statusLabel);

	/** A connector takes the colour of the step before it; running is not settled. */
	function connectorSettled(index: number): boolean {
		const before = steps[index - 1].status;
		return before === "done" || before === "skipped";
	}

	// Tap opens the tooltip on touch, where hover never fires. One index rather
	// than one flag per step so opening a second closes the first.
	let openStep = $state(-1);

	// The glyphs are decorative and do not clear 4.5:1, so this label is the
	// accessible carrier of each step's position, name and status.
	function accessibleName(step: MlPlanStep, index: number) {
		return `Step ${index + 1}, ${step.label} — ${step.status}`;
	}
</script>

<div class="flex min-w-0 items-center gap-[14px]">
	<Tooltip.Provider delayDuration={80} disableHoverableContent>
		<div
			role="list"
			class="ml-step-row flex flex-none items-center gap-[3px] @min-[240px]:gap-1 @min-[560px]:gap-0"
		>
			{#each steps as step, index (index)}
				{#if index > 0}
					<!-- Connectors are the first thing to go: below 560 the chain carries
					     its own gap instead. -->
					<span
						aria-hidden="true"
						class="hidden h-[1.5px] w-[12px] flex-none @min-[560px]:block {connectorSettled(index)
							? 'bg-[#e8622a]'
							: 'bg-[#e0ddd8] dark:bg-[#333333]'}"
					></span>
				{/if}
				<span role="listitem" class="contents">
					<Tooltip.Root
						open={openStep === index}
						onOpenChange={(open) => (openStep = open ? index : -1)}
						disableCloseOnTriggerClick
					>
						<Tooltip.Trigger
							class="ml-step-hit"
							aria-label={accessibleName(step, index)}
							aria-current={step.status === "running" ? "step" : undefined}
							onclick={() => (openStep = openStep === index ? -1 : index)}
						>
							{#if step.status === "done"}
								<span class="ml-step-glyph grid place-items-center rounded-full bg-[#e8622a]">
									<!-- A dot is a filled circle and nothing else; the check needs
									     room the 8px and 6px sizes do not have. -->
									<svg
										viewBox="0 0 12 12"
										class="hidden size-[9px] @min-[340px]:block"
										fill="none"
										stroke="#fff"
										stroke-width="2.4"
										stroke-linecap="round"
										stroke-linejoin="round"
										aria-hidden="true"
									>
										<path d="M2 6.5l2.5 2.5L10 3.5" />
									</svg>
								</span>
							{:else if step.status === "skipped"}
								<span
									class="ml-step-glyph grid place-items-center rounded-full border-[1.5px] border-[#e8622a]"
								>
									<span
										class="hidden h-[1.5px] w-[7px] rounded-[1px] bg-[#e8622a] @min-[340px]:block"
									></span>
								</span>
							{:else if step.status === "running"}
								<!-- Core plus a ring that breathes past the slot; the chain's
								     gaps absorb the overflow, so it takes no margin. -->
								<span class="ml-step-glyph ml-step-running"></span>
							{:else}
								<span
									class="ml-step-glyph rounded-full border-[1.5px] border-[#cfcbc5] dark:border-[#444444]"
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
				</span>
			{/each}
		</div>
	</Tooltip.Provider>

	<span
		class={[
			"hidden flex-none text-[13px] leading-none whitespace-nowrap @min-[480px]:block",
			complete
				? "font-semibold text-[#c4511a] dark:text-[#f0a468]"
				: "font-medium text-[#78716c] dark:text-[#a8a29e]",
		]}
		aria-live="polite"
		aria-atomic="true"
	>
		{statusText}
	</span>
</div>

<style>
	/* One size drives the glyph, its hit target and the pulse, so a breakpoint
	   moves them together. */
	.ml-step-row {
		--step: 6px;
	}

	@container (min-width: 240px) {
		.ml-step-row {
			--step: 8px;
		}
	}

	@container (min-width: 340px) {
		.ml-step-row {
			--step: 16px;
		}
	}

	/* box-sizing keeps a 1.5px ring the same size as a filled dot. */
	.ml-step-glyph {
		box-sizing: border-box;
		flex: none;
		width: var(--step);
		height: var(--step);
	}

	/* Keeps the glyph's own footprint so the row lays out on the designed
	   spacing, while giving touch a 44px-tall target. */
	:global(.ml-step-hit) {
		display: grid;
		place-items: center;
		width: var(--step);
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

	.ml-step-running {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.ml-step-running::before {
		content: "";
		position: absolute;
		inset: 0;
		border-radius: 50%;
		background: #e8622a;
		animation: ml-step-pulse 1.4s ease-out infinite;
	}

	.ml-step-running::after {
		content: "";
		width: calc(var(--step) / 2);
		height: calc(var(--step) / 2);
		border-radius: 50%;
		background: #e8622a;
	}

	@keyframes ml-step-pulse {
		0% {
			transform: scale(0.55);
			opacity: 0.55;
		}
		100% {
			transform: scale(1.5);
			opacity: 0;
		}
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

	/* A soft halo instead of a breath — the running step still reads as itself. */
	@media (prefers-reduced-motion: reduce) {
		.ml-step-running::before {
			animation: none;
			transform: none;
			opacity: 0.2;
		}
		:global(.ml-step-tooltip) {
			animation: none;
		}
	}
</style>
