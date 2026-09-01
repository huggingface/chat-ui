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
		"inline-flex h-8 flex-none items-center gap-1.5 rounded-full px-2.5 text-xs font-semibold transition-colors sm:h-7",
		enabled
			? "bg-[#fff4ea] text-[#c2410c] dark:bg-[#2b1c0e] dark:text-[#fdba74]"
			: "bg-gray-500/10 text-gray-500 dark:bg-gray-500/15 dark:text-gray-400",
	]}
>
	<Switch.Root
		class="ml-pill-switch flex cursor-pointer items-center gap-1.5 whitespace-nowrap select-none"
		checked={enabled}
		onCheckedChange={ontoggle}
		aria-label="ML Intern mode"
	>
		<span class="ml-pill-track" class:is-on={enabled}>
			<Switch.Thumb class="ml-pill-knob" />
		</span>
		ML Intern
		<span
			class="rounded-md bg-[#ea580c] px-[5px] py-[3px] text-[10px] leading-none font-bold tracking-wide text-white"
		>
			NEW
		</span>
	</Switch.Root>
</div>

<style>
	:global(.ml-pill-switch) {
		padding: 0;
		border: 0;
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

	:global(.ml-pill-switch:focus-visible) .ml-pill-track {
		outline: 2px solid #ea580c;
		outline-offset: 2px;
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
