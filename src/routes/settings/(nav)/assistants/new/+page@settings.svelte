<script lang="ts">
	import AssistantSettings from "$lib/components/AssistantSettings.svelte";
	import type { PageData } from "./$types";

	interface Props {
		data: PageData;
	}

	let { data }: Props = $props();
</script>

<AssistantSettings models={data.models} />
