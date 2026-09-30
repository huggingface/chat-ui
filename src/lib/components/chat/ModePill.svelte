<script lang="ts">
	import { Switch } from "bits-ui";

	/** An agent mode's pre-task switch beside the MCP pill, with its own accent. */
	interface Props {
		label: string;
		checked: boolean;
		onCheckedChange: (next: boolean) => void;
		tone: "ml" | "paperpage";
	}

	let { label, checked, onCheckedChange, tone }: Props = $props();

	const TONES = {
		ml: {
			on: "bg-[#fff4ea] text-[#c2410c] dark:bg-[#2b1c0e] dark:text-[#fdba74]",
			badge: "bg-[#ea580c]/20 text-[#c2410c] dark:bg-[#ea580c]/25 dark:text-[#fdba74]",
		},
		paperpage: {
			on: "bg-[#ecfdf5] text-[#047857] dark:bg-[#0b2a20] dark:text-[#6ee7b7]",
			badge: "bg-[#10b981]/20 text-[#047857] dark:bg-[#10b981]/25 dark:text-[#6ee7b7]",
		},
	};
</script>

<div
	class={[
		// Horizontal padding matches the gap above/below the 17px track (and the
		// ~16px badge): 7.5px at h-8, 5.5px at h-7. px-2.5 left the ends looking loose.
		"inline-flex h-8 flex-none items-center gap-1.5 rounded-full px-2 text-xs font-semibold transition-colors sm:h-7 sm:px-1.5",
		// Keyboard focus lands on the inner switch button; ring the whole pill so
		// the indicator follows its rounded shape instead of the button's box.
		"has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-blue-500/60 dark:has-focus-visible:outline-blue-400/60",
		checked
			? TONES[tone].on
			: "bg-gray-500/10 text-gray-500 dark:bg-gray-500/15 dark:text-gray-400",
	]}
>
	<!-- h-full so the tap target is the pill's full height, not the 17px track. -->
	<Switch.Root
		class="mode-pill-switch flex h-full cursor-pointer items-center gap-1.25 whitespace-nowrap select-none"
		{checked}
		{onCheckedChange}
		aria-label="{label} mode"
	>
		<span class="mode-pill-track {tone}" class:is-on={checked}>
			<Switch.Thumb class="mode-pill-knob" />
		</span>
		{label}
		<!-- Tinted accent with darker text, like the MCP pill's inner button. -->
		<span
			class="rounded-md px-[5px] py-[3px] text-[10px] leading-none font-bold {TONES[tone].badge}"
		>
			NEW
		</span>
	</Switch.Root>
</div>

<style>
	/* The pill draws the focus ring (see has-focus-visible: below), so the
	   button's own rectangular UA outline would only double it up. */
	:global(.mode-pill-switch) {
		padding: 0;
		border: 0;
		outline: 0;
		background: transparent;
		color: inherit;
	}

	.mode-pill-track {
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

	.mode-pill-track.ml.is-on {
		background: #ea580c;
	}

	.mode-pill-track.paperpage.is-on {
		background: #10b981;
	}

	:global(.dark) .mode-pill-track {
		background: #3a3a42;
	}

	:global(.dark) .mode-pill-track.ml.is-on {
		background: #3b5ce0;
	}

	:global(.dark) .mode-pill-track.paperpage.is-on {
		background: #10b981;
	}

	:global(.mode-pill-knob) {
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

	:global(.mode-pill-knob[data-state="checked"]) {
		left: 15px;
	}

	@media (prefers-reduced-motion: reduce) {
		.mode-pill-track,
		:global(.mode-pill-knob) {
			transition: none;
		}
	}
</style>
