<script lang="ts">
	import { Switch } from "bits-ui";
	import { requireAuthUser } from "$lib/utils/auth";
	import { useSettingsStore } from "$lib/stores/settings";
	import { mlAssistant } from "$lib/stores/mlAssistant.svelte";
	import MlInternOnboardingModal from "./MlInternOnboardingModal.svelte";

	const settings = useSettingsStore();

	let enabled = $derived(mlAssistant.enabled);
	let onboardingOpen = $state(false);

	function ontoggle(next: boolean) {
		if (requireAuthUser()) return;
		mlAssistant.toggle(next);
		// The mode stays on underneath: the modal is advice, not a confirmation step.
		if (next && !$settings.mlInternOnboardingSeen) onboardingOpen = true;
	}

	function closeOnboarding() {
		// Escape reaches Modal's window and dialog handlers before the unmount
		// lands, so this runs twice; one acknowledgement is enough.
		if (!onboardingOpen) return;
		onboardingOpen = false;
		settings.instantSet({ mlInternOnboardingSeen: true });
	}

	function readDraftBudget(event: Event) {
		const raw = (event.currentTarget as HTMLInputElement).value.trim();
		const usd = Number(raw);
		mlAssistant.draftBudgetUsd = raw !== "" && Number.isFinite(usd) && usd > 0 ? usd : undefined;
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
		class="ml-pill-switch flex h-full cursor-pointer items-center gap-1.5 whitespace-nowrap select-none"
		checked={enabled}
		onCheckedChange={ontoggle}
		aria-label="ML Intern mode"
	>
		<span class="ml-pill-track" class:is-on={enabled}>
			<Switch.Thumb class="ml-pill-knob" />
		</span>
		ML Intern
		<!-- The darker text-orange, not the surface accent: white 10px text on
		     #ea580c is 3.56:1, on #c2410c it clears the 4.5:1 floor. -->
		<span
			class="rounded-md bg-[#c2410c] px-[5px] py-[3px] text-[10px] leading-none font-bold tracking-wide text-white"
		>
			NEW
		</span>
	</Switch.Root>

	{#if enabled}
		<!-- Spend authority is granted here, before any run exists: the next send
		     creates the conversation with exactly this budget, and $0 means every
		     submission is refused until the user grants one. Outside the switch so
		     typing a number cannot toggle the mode. -->
		<label class="flex flex-none items-center gap-0.5 font-mono text-[11px] font-normal">
			<span>$</span>
			<input
				value={mlAssistant.draftBudgetUsd ?? ""}
				oninput={readDraftBudget}
				type="number"
				min="1"
				max="10000"
				step="1"
				placeholder="0"
				class="ml-pill-budget w-11 rounded border border-current/30 bg-transparent px-1 py-0 text-right text-[11px] placeholder:text-current/40"
				aria-label="Compute budget for this session in dollars"
			/>
		</label>
	{/if}
</div>

{#if onboardingOpen}
	<MlInternOnboardingModal close={closeOnboarding} />
{/if}

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

	/* Spinner arrows would be the only chrome on the pill's compact money
	   field, and the value is typed, not stepped. */
	.ml-pill-budget {
		appearance: textfield;
	}

	.ml-pill-budget::-webkit-outer-spin-button,
	.ml-pill-budget::-webkit-inner-spin-button {
		appearance: none;
		margin: 0;
	}

	@media (prefers-reduced-motion: reduce) {
		.ml-pill-track,
		:global(.ml-pill-knob) {
			transition: none;
		}
	}
</style>
