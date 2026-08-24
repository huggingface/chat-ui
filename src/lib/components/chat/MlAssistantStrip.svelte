<script lang="ts">
	import { Switch } from "bits-ui";
	import MlAssistantPlanProgress from "./MlAssistantPlanProgress.svelte";
	import { ML_ASSISTANT_NOTE_OFF, ML_ASSISTANT_TOOLS } from "$lib/constants/mlAssistant";
	import type { MlPlanStep } from "$lib/types/MlAssistant";

	interface Props {
		/** Collapses the strip out of the composer when false, rather than unmounting it. */
		visible: boolean;
		enabled: boolean;
		/** Locks the switch and swaps the tool note for the plan progress row. */
		taskRunning: boolean;
		steps: MlPlanStep[];
		statusLabel: string;
		complete: boolean;
		ontoggle: (enabled: boolean) => void;
		/**
		 * Opens the preset's tool and prompt configuration. That panel doesn't exist
		 * yet, so the link renders as designed but does nothing until one is passed.
		 */
		onconfigure?: () => void;
	}

	let {
		visible,
		enabled,
		taskRunning,
		steps,
		statusLabel,
		complete,
		ontoggle,
		onconfigure,
	}: Props = $props();
</script>

<div class="ml-strip-collapse" class:is-open={visible} inert={!visible}>
	<div
		class={[
			"ml-strip flex items-center gap-[9px] border-b px-4 py-[9px] text-[13.5px]",
			enabled
				? "border-[#e2e7fb] bg-[#f0f3ff] text-[#2244cc] dark:border-[#2b3357] dark:bg-[#151a2e] dark:text-[#93a4f0]"
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
				aria-label="ML Assistant mode"
			>
				<span class="ml-switch-track" class:is-on={enabled}>
					<Switch.Thumb class="ml-switch-knob" />
				</span>
			</Switch.Root>
		</span>

		<!-- The switch is gone once a task is running, so the title has to be what
		     tells a screen reader the mode is on. -->
		<span class="flex-none" class:font-semibold={enabled}>
			ML Assistant{#if taskRunning}<span class="sr-only">, mode on</span>{/if}
		</span>

		<!-- The plan replaces the tool note, but only once there is a plan to show:
		     a run that has not reported its steps yet would otherwise leave a gap. -->
		{#if taskRunning && steps.length}
			<MlAssistantPlanProgress {steps} {statusLabel} {complete} />
		{:else if enabled}
			<span class="truncate font-mono text-xs text-[#7f8cd8]">
				{ML_ASSISTANT_TOOLS.join(" · ")}
			</span>
		{:else}
			<span class="truncate text-[#c2c2c8] dark:text-gray-600">{ML_ASSISTANT_NOTE_OFF}</span>
		{/if}

		<span class="ml-auto"></span>

		{#if enabled && !taskRunning}
			<button
				type="button"
				class="flex-none cursor-pointer text-[13.5px] text-[#7f8cd8] hover:underline"
				onclick={onconfigure}
			>
				Configure
			</button>
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
		background: #2244cc;
	}

	:global(.dark) .ml-switch-track {
		background: #3a3a42;
	}

	:global(.dark) .ml-switch-track.is-on {
		background: #3b5ce0;
	}

	:global(.ml-switch:focus-visible) .ml-switch-track {
		outline: 2px solid #2244cc;
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
