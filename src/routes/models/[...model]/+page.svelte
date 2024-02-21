<script lang="ts">
	import { useSettingsStore } from "$lib/stores/settings";
	import { page } from "$app/stores";
	import { onMount } from "svelte";
	import { goto } from "$app/navigation";
	import { base } from "$app/paths";
	import { PUBLIC_APP_NAME, PUBLIC_ORIGIN } from "$env/static/public";

	const settings = useSettingsStore();

	const model = $page.params.model;

	onMount(async () => {
		$settings.activeModel = model;
		await goto(`${base}/`, { invalidateAll: true });
	});
</script>

<svelte:head>
	<meta property="og:title" content={model + " - " + PUBLIC_APP_NAME} />
	<meta property="og:type" content="link" />
	<meta property="og:description" content={`Use ${model} inside of ${PUBLIC_APP_NAME}`} />
	<meta
		property="og:image"
		content="{PUBLIC_ORIGIN || $page.url.origin}{base}/model/{model}/thumbnail.png"
	/>
	<meta property="og:url" content={$page.url.href} />
	<meta name="twitter:card" content="summary_large_image" />
</svelte:head>
