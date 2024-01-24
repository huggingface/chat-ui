<script lang="ts">
	import type { ActionData, PageData } from "./$types";
	import AssistantSettings from "$lib/components/AssistantSettings.svelte";

	export let data: PageData;
	export let form: ActionData;
</script>

<AssistantSettings bind:form models={data.models} />
