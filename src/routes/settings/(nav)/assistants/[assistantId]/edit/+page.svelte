<script lang="ts">
	import type { PageData } from "./$types";
	import { page } from "$app/state";
	import AssistantSettings from "$lib/components/AssistantSettings.svelte";

	interface Props {
		data: PageData;
	}

	let { data }: Props = $props();

	let assistant = data.assistants.find((el) => el._id.toString() === page.params.assistantId);
</script>

<AssistantSettings
	assistant={assistant
		? {
				...assistant,
				updatedAt: new Date(assistant.updatedAt),
				createdAt: new Date(assistant.createdAt),
			}
		: undefined}
	models={data.models}
/>
