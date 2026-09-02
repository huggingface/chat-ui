<script lang="ts">
	import { Switch } from "bits-ui";
	import { requireAuthUser } from "$lib/utils/auth";
	import { mlAssistant } from "$lib/stores/mlAssistant.svelte";

	let enabled = $derived(mlAssistant.enabled);

	function ontoggle(next: boolean) {
		if (requireAuthUser()) return;
		mlAssistant.toggle(next);
	}
</script>

<!-- The mode's pre-task switch, sitting beside the MCP pill. Only offered while
     the conversation is still empty: once a task starts the status strip takes
     over, and once a chat starts without the mode the composer stays as it is
     (the mode cannot be joined mid-conversation). Deliberately not dismissable:
     this is the mode's only entry point, and nothing could bring it back. -->
<div
	class={[
		// Horizontal padding matches the gap above/below the 17px track (and the
		// ~16px badge): 7.5px at h-8, 5.5px at h-7. px-2.5 left the ends looking loose.
		"inline-flex h-8 flex-none items-center gap-1.5 rounded-full px-2 text-xs font-semibold transition-colors sm:h-7 sm:px-1.5",
		// Keyboard focus lands on the inner switch button; ring the whole pill so
		// the indicator follows its rounded shape instead of the button's box.
		"has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-blue-500/60 dark:has-focus-visible:outline-blue-400/60",
		enabled
			? "bg-[#fff4ea] text-[#c2410c] dark:bg-[#2b1c0e] dark:text-[#fdba74]"
			: "bg-gray-500/10 text-gray-500 dark:bg-gray-500/15 dark:text-gray-400",
	]}
>
	<!-- h-full so the tap target is the pill's full height, not the 17px track. -->
	<Switch.Root
		class="ml-pill-switch flex h-full cursor-pointer items-center gap-1.25 whitespace-nowrap select-none"
		checked={enabled}
		onCheckedChange={ontoggle}
		aria-label="ML Intern mode"
	>
		<span class="ml-pill-track" class:is-on={enabled}>
			<Switch.Thumb class="ml-pill-knob" />
		</span>
		ML Intern
		<!-- Tinted accent with orange text, like the MCP pill's inner button. -->
		<span
			class="rounded-md bg-[#ea580c]/20 px-[5px] py-[3px] text-[10px] leading-none font-bold text-[#c2410c] dark:bg-[#ea580c]/25 dark:text-[#fdba74]"
		>
			NEW
		</span>
	</Switch.Root>
</div>

<style>
	/* The pill draws the focus ring (see has-focus-visible: below), so the
	   button's own rectangular UA outline would only double it up. */
	:global(.ml-pill-switch) {
		padding: 0;
		border: 0;
		outline: 0;
		background: transparent;
		color: inherit;
	}

	.ml-pill-track {
		position: relative;
		display: block;
		flex: none;
		width: 30px;
		height: 17px;
		border-radius: 999px;
		overflow: hidden;
		background: #d8d8dd;
		transition: background 0.3s ease;
	}

	.ml-pill-track.is-on {
		background: #ea580c;
	}

	:global(.dark) .ml-pill-track {
		background: #3a3a42;
	}

	:global(.dark) .ml-pill-track.is-on {
		background: #3b5ce0;
	}

	:global(.ml-pill-knob) {
		position: absolute;
		top: 2px;
		left: 2px;
		display: block;
		width: 13px;
		height: 13px;
		border-radius: 50%;
		background: #fff;
		transition: left 0.28s cubic-bezier(0.4, 0, 0.2, 1);
	}

	:global(.ml-pill-knob[data-state="checked"]) {
		left: 15px;
	}

	@media (prefers-reduced-motion: reduce) {
		.ml-pill-track,
		:global(.ml-pill-knob) {
			transition: none;
		}
	}
</style>
