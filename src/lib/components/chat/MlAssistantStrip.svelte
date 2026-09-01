<script lang="ts">
	import MlAssistantPlanProgress from "./MlAssistantPlanProgress.svelte";
	import { ML_ASSISTANT_TOOLS } from "$lib/constants/mlAssistant";
	import type { MlPlanStep } from "$lib/types/MlAssistant";

	interface Props {
		/** Collapses the strip out of the composer when false, rather than unmounting it. */
		visible: boolean;
		steps: MlPlanStep[];
		statusLabel: string;
		complete: boolean;
	}

	let { visible, steps, statusLabel, complete }: Props = $props();
</script>

<!-- Status surface only: the strip appears once a task locks the mode onto the
     conversation, and the mode's on/off switch lives in the composer pill
     (MlInternPill.svelte), so there is nothing to operate here. -->
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

	@media (prefers-reduced-motion: reduce) {
		.ml-strip-collapse {
			transition: none;
		}
	}
</style>
