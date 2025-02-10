<script lang="ts">
	import type { PageData } from "./$types";
	import { page } from "$app/state";
	import AssistantSettings from "$lib/components/AssistantSettings.svelte";

	interface Props {
		data: PageData;
	}

	let { data, form = $bindable() }: Props = $props();

	let assistant = data.assistants.find((el) => el._id.toString() === page.params.assistantId);
</script>

<AssistantSettings {assistant} models={data.models} />
