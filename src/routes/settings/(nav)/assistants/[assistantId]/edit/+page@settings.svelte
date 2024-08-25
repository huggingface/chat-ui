<script lang="ts">
	import type { PageData, ActionData } from "./$types";
	import { page } from "$app/stores";
	import AssistantSettings from "$lib/components/AssistantSettings.svelte";

	export let data: PageData;
	export let form: ActionData;

	let assistant = data.assistants.find((el) => el._id.toString() === $page.params.assistantId);
</script>

<AssistantSettings bind:form {assistant} models={data.models} />
