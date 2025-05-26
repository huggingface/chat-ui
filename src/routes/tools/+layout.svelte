<script lang="ts">
	import { publicConfig } from "$lib/utils/PublicConfig.svelte";
	import { base } from "$app/paths";
	import { page } from "$app/state";
	interface Props {
		children?: import("svelte").Snippet;
	}

	let { children }: Props = $props();
</script>

<svelte:head>
	{#if publicConfig.isHuggingChat}
		<title>HuggingChat - Tools</title>
		<meta property="og:title" content="HuggingChat - Tools" />
		<meta property="og:type" content="link" />
		<meta property="og:description" content="Browse HuggingChat tools made by the community." />
		<meta
			property="og:image"
			content="{publicConfig.PUBLIC_ORIGIN ||
				page.url.origin}{base}/{publicConfig.PUBLIC_APP_ASSETS}/tools-thumbnail.png"
		/>
		<meta property="og:url" content={page.url.href} />
	{/if}
</svelte:head>

{@render children?.()}
