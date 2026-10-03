<script lang="ts">
	import { page } from "$app/state";
	import { requireAuthUser } from "$lib/utils/auth";
	import { useSettingsStore } from "$lib/stores/settings";
	import { agentMode } from "$lib/stores/agentMode.svelte";
	import { mlAssistant } from "$lib/stores/mlAssistant.svelte";
	import ModePill from "./ModePill.svelte";

	const settings = useSettingsStore();

	function ontoggle(next: boolean) {
		if (requireAuthUser()) return;
		if (!next) return agentMode.clearPending();
		const data = page.data as { paperPageModel?: string | null; models?: { id: string }[] };
		agentMode.start("paperpage", data.paperPageModel, data.models ?? [], $settings.activeModel);
		// one mode per conversation
		mlAssistant.toggle(false);
	}
</script>

<!-- PaperPage Intern's switch, beside ML Intern's: same as the ?mode=paperpage-intern link. -->
<ModePill
	label="PaperPage Intern"
	checked={agentMode.pending === "paperpage"}
	onCheckedChange={ontoggle}
	tone="paperpage"
/>
