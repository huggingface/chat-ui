<script lang="ts">
	import { onDestroy, untrack } from "svelte";
	import { requireAuthUser } from "$lib/utils/auth";
	import { useSettingsStore } from "$lib/stores/settings";
	import { mlAssistant } from "$lib/stores/mlAssistant.svelte";
	import { agentMode } from "$lib/stores/agentMode.svelte";
	import ModePill from "./ModePill.svelte";
	import MlInternOnboardingModal from "./MlInternOnboardingModal.svelte";

	const settings = useSettingsStore();

	let enabled = $derived(mlAssistant.enabled);

	function ontoggle(next: boolean) {
		if (requireAuthUser()) return;
		mlAssistant.toggle(next);
		// one mode per conversation
		if (next) agentMode.clearPending();
	}

	// First time the mode goes on (from the switch or the home-screen card), open the
	// onboarding. Edge-triggered, so a pill mounted with the mode already on stays quiet.
	let wasEnabled: boolean | undefined;
	$effect(() => {
		const on = enabled;
		const seen = $settings.mlInternOnboardingSeen;
		untrack(() => {
			if (on && wasEnabled === false && !seen) mlAssistant.onboardingOpen = true;
			wasEnabled = on;
		});
	});

	function closeOnboarding() {
		// Escape reaches Modal's window and dialog handlers before the unmount
		// lands, so this runs twice; one acknowledgement is enough.
		if (!mlAssistant.onboardingOpen) return;
		mlAssistant.onboardingOpen = false;
		settings.instantSet({ mlInternOnboardingSeen: true });
	}

	onDestroy(() => {
		mlAssistant.onboardingOpen = false;
	});
</script>

<!-- The mode's pre-task switch, sitting beside the MCP pill. Only offered while
     the conversation is still empty: once a task starts the status strip takes
     over, and once a chat starts without the mode the composer stays as it is
     (the mode cannot be joined mid-conversation). Deliberately not dismissable:
     this is the mode's only entry point, and nothing could bring it back. -->
<ModePill label="ML Intern" checked={enabled} onCheckedChange={ontoggle} tone="ml" />

{#if mlAssistant.onboardingOpen && $settings.welcomeModalSeen}
	<MlInternOnboardingModal close={closeOnboarding} />
{/if}
