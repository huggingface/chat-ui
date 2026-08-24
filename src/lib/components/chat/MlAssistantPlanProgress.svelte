<script lang="ts">
	import { Tooltip } from "bits-ui";
	import type { MlPlanStep } from "$lib/types/MlAssistant";

	interface Props {
		steps: MlPlanStep[];
		/** Status label for the running step, or "Done" once the plan finishes. */
		statusLabel: string;
		complete: boolean;
	}

	let { steps, statusLabel, complete }: Props = $props();

	// Tap opens the tooltip on touch, where hover never fires. One index rather
	// than one flag per dot so opening a second dot closes the first.
	let openStep = $state(-1);

	function accessibleName(step: MlPlanStep) {
		return `${step.label} — ${step.status}`;
	}
</script>

<div class="flex items-center gap-3">
	<Tooltip.Provider delayDuration={80} disableHoverableContent>
		<div class="flex items-center gap-[5px]">
			{#each steps as step, index (index)}
				<Tooltip.Root
					open={openStep === index}
					onOpenChange={(open) => (openStep = open ? index : -1)}
					disableCloseOnTriggerClick
				>
					<Tooltip.Trigger
						class="ml-dot-hit"
						aria-label={accessibleName(step)}
						onclick={() => (openStep = openStep === index ? -1 : index)}
					>
						<span class="ml-dot" data-status={step.status}>{index + 1}</span>
					</Tooltip.Trigger>
					<Tooltip.Portal>
						<Tooltip.Content class="ml-dot-tooltip" side="top" sideOffset={10}>
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
			"text-[13.5px] leading-none font-medium whitespace-nowrap",
			complete ? "text-[#16a34a] dark:text-[#4ade80]" : "text-[#2244cc] dark:text-[#93a4f0]",
		]}
		aria-live="polite"
		aria-atomic="true"
	>
		{statusLabel}
	</span>
</div>

<style>
	/* 27x44 hit target that leaves the 22px dot's footprint untouched, so the row
	   still lays out on the designed 5px gap. */
	:global(.ml-dot-hit) {
		display: grid;
		place-items: center;
		width: 27px;
		height: 44px;
		margin: -11px -2.5px;
		padding: 0;
		border: 0;
		background: transparent;
	}

	:global(.ml-dot-hit:focus-visible) {
		outline: 2px solid #2244cc;
		outline-offset: -8px;
		border-radius: 8px;
	}

	.ml-dot {
		display: grid;
		place-items: center;
		box-sizing: border-box;
		width: 22px;
		height: 22px;
		border-radius: 50%;
		font-family: var(--font-mono, ui-monospace, monospace);
		font-size: 11px;
		font-weight: 500;
		line-height: 1;
		transition:
			background 0.3s,
			border-color 0.3s,
			color 0.3s;
	}

	.ml-dot[data-status="pending"] {
		background: #fff;
		border: 1px solid #dcdce2;
		color: #b0b0b8;
	}

	.ml-dot[data-status="running"] {
		background: #2244cc;
		border: 1px solid #2244cc;
		color: #fff;
		animation: mlpulse 1.5s ease-in-out infinite;
	}

	.ml-dot[data-status="done"] {
		background: #16a34a;
		border: 1px solid #16a34a;
		color: #fff;
	}

	.ml-dot[data-status="skipped"] {
		background: #eeeef1;
		border: 1px solid #eeeef1;
		color: #b4b4bc;
		opacity: 0.65;
	}

	:global(.dark) .ml-dot[data-status="pending"] {
		background: transparent;
		border-color: #3a3a42;
		color: #7a7a84;
	}

	:global(.dark) .ml-dot[data-status="skipped"] {
		background: #26262c;
		border-color: #26262c;
		color: #6f6f79;
	}

	@keyframes mlpulse {
		0%,
		100% {
			box-shadow: 0 0 0 0 rgba(34, 68, 204, 0.45);
		}
		50% {
			box-shadow: 0 0 0 5px rgba(34, 68, 204, 0);
		}
	}

	:global(.ml-dot-tooltip) {
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
		.ml-dot[data-status="running"] {
			animation: none;
		}
		:global(.ml-dot-tooltip) {
			animation: none;
		}
	}
</style>
