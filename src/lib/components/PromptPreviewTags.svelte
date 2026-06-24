<script lang="ts">
	import { page } from "$app/state";
	import { base } from "$app/paths";
	import { usePublicConfig } from "$lib/utils/PublicConfig.svelte";
	import { cleanTextForMeta } from "$lib/utils/sharePreviewText";

	interface Props {
		/** Sanitized prompt text from a ?q= / ?prompt= deep link (see promptFromLinkParams) */
		prompt: string;
	}

	let { prompt }: Props = $props();

	const publicConfig = usePublicConfig();

	let urlBase = $derived(`${publicConfig.PUBLIC_ORIGIN || page.url.origin}${base}`);

	let ogTitle = $derived(
		`${cleanTextForMeta(prompt, 100) || "Chat with AI models"} - ${publicConfig.PUBLIC_APP_NAME}`
	);
	let ogDescription = $derived(
		cleanTextForMeta(prompt, 200) || publicConfig.PUBLIC_APP_DESCRIPTION
	);
	// Canonical link the user actually shared (keeps the original query string).
	let ogUrl = $derived(`${urlBase}/${page.url.search}`);
	// The thumbnail endpoint accepts either param and renders the same card, so
	// always pass ?q=. Cap the echoed text: the card only renders ~240 chars and
	// over-long query strings get truncated by some crawlers.
	let ogImage = $derived(
		`${urlBase}/thumbnail.png?q=${encodeURIComponent(cleanTextForMeta(prompt, 240))}`
	);
</script>

<svelte:head>
	<meta property="og:title" content={ogTitle} />
	<meta property="og:type" content="website" />
	<meta property="og:description" content={ogDescription} />
	<meta property="og:url" content={ogUrl} />
	<meta property="og:image" content={ogImage} />
	<meta property="og:image:width" content="1200" />
	<meta property="og:image:height" content="648" />
	<meta property="og:image:alt" content={ogTitle} />
	<meta property="og:site_name" content={publicConfig.PUBLIC_APP_NAME} />
	<meta property="og:locale" content="en_US" />
	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:title" content={ogTitle} />
	<meta name="twitter:description" content={ogDescription} />
	<meta name="twitter:image" content={ogImage} />
	<meta name="twitter:image:alt" content={ogTitle} />
</svelte:head>
