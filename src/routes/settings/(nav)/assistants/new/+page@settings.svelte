<script lang="ts">
	import type { ActionData, PageData } from "./$types";
	import AssistantSettings from "$lib/components/AssistantSettings.svelte";

	interface Props {
		data: PageData;
		form: ActionData;
	}

	let { data, form = $bindable() }: Props = $props();
</script>

<AssistantSettings bind:form models={data.models} />
