<script lang="ts">
	import { page } from "$app/state";
	import { base } from "$app/paths";
	import { usePublicConfig } from "$lib/utils/PublicConfig.svelte";
	import { cleanTextForMeta, extractFirstUserPrompt } from "$lib/utils/sharePreviewText";
	import type { Message } from "$lib/types/Message";

	interface Props {
		shareId: string;
		title?: string;
		messages: Message[];
		rootMessageId?: string;
	}

	let { shareId, title, messages, rootMessageId }: Props = $props();

	const publicConfig = usePublicConfig();

	let urlBase = $derived(`${publicConfig.PUBLIC_ORIGIN || page.url.origin}${base}`);
	let ogTitle = $derived.by(() => {
		const cleaned = cleanTextForMeta(title ?? "", 100) || "Shared conversation";
		return `${cleaned} - ${publicConfig.PUBLIC_APP_NAME}`;
	});
	let ogDescription = $derived(
		cleanTextForMeta(extractFirstUserPrompt(messages, rootMessageId), 200) ||
			`A conversation shared from ${publicConfig.PUBLIC_APP_NAME}`
	);
</script>

<svelte:head>
	<meta property="og:title" content={ogTitle} />
	<meta property="og:type" content="website" />
	<meta property="og:description" content={ogDescription} />
	<meta property="og:url" content="{urlBase}/r/{shareId}" />
	<meta property="og:image" content="{urlBase}/r/{shareId}/thumbnail.png" />
	<meta property="og:image:width" content="1200" />
	<meta property="og:image:height" content="648" />
	<meta property="og:image:alt" content={ogTitle} />
	<meta property="og:site_name" content={publicConfig.PUBLIC_APP_NAME} />
	<meta property="og:locale" content="en_US" />
	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:title" content={ogTitle} />
	<meta name="twitter:description" content={ogDescription} />
	<meta name="twitter:image" content="{urlBase}/r/{shareId}/thumbnail.png" />
	<meta name="twitter:image:alt" content={ogTitle} />
</svelte:head>
