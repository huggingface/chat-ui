<script lang="ts">
	import { env as envPublic } from "$env/dynamic/public";
	import { isHuggingChat } from "$lib/utils/isHuggingChat";
	import { base } from "$app/paths";
	import { page } from "$app/stores";
</script>

<svelte:head>
	{#if isHuggingChat}
		<title>HuggingChat - Tools</title>
		<meta property="og:title" content="HuggingChat - Tools" />
		<meta property="og:type" content="link" />
		<meta property="og:description" content="Browse HuggingChat tools made by the community." />
		<meta
			property="og:image"
			content="{envPublic.PUBLIC_ORIGIN ||
				$page.url.origin}{base}/{envPublic.PUBLIC_APP_ASSETS}/tools-thumbnail.png"
		/>
		<meta property="og:url" content={$page.url.href} />
	{/if}
</svelte:head>

<slot />
