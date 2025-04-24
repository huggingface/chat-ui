<script lang="ts">
	import { env as envPublic } from "$env/dynamic/public";
	import { isHuggingChat } from "$lib/utils/isHuggingChat";
	import { base } from "$app/paths";
	import { page } from "$app/state";
	import { useTranslations } from "$lib/stores/translations";
	interface Props {
		children?: import("svelte").Snippet;
	}

	let { children }: Props = $props();

	const translations = useTranslations();
</script>

<svelte:head>
	{#if isHuggingChat}
		<title>HuggingChat - {$translations.t("tools")}</title>
		<meta property="og:title" content="HuggingChat - {$translations.t('tools')}" />
		<meta property="og:type" content="link" />
		<meta property="og:description" content={$translations.t("popular_tools")} />
		<meta
			property="og:image"
			content="{envPublic.PUBLIC_ORIGIN ||
				page.url.origin}{base}/{envPublic.PUBLIC_APP_ASSETS}/tools-thumbnail.png"
		/>
		<meta property="og:url" content={page.url.href} />
	{/if}
</svelte:head>

{@render children?.()}
