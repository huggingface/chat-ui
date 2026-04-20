<script lang="ts">
	import { onMount } from "svelte";
	import { goto } from "$app/navigation";
	import { base } from "$app/paths";
	import { page } from "$app/state";
	import { useAPIClient, handleResponse } from "$lib/APIClient";
	import { usePublicConfig } from "$lib/utils/PublicConfig.svelte";

	let { data } = $props();

	const publicConfig = usePublicConfig();

	onMount(async () => {
		const leafId = page.url.searchParams.get("leafId");
		const shareId = page.params.id;

		// If logged in, try to import the share
		if (data.loginEnabled && data.user && shareId) {
			const client = useAPIClient();
			try {
				const result = await client.conversations["import-share"]
					.post({ shareId })
					.then(handleResponse);
				if (result.conversationId) {
					await goto(
						`${base}/conversation/${result.conversationId}?leafId=${leafId ?? ""}&fromShare=${shareId}`,
						{ replaceState: true }
					);
					return;
				}
			} catch {
				// Fall through to view-only mode
			}
		}

		// Not logged in or import failed: view-only mode
		await goto(`${base}/conversation/${shareId}${leafId ? `?leafId=${leafId}` : ""}`, {
			replaceState: true,
		});
	});
</script>

<svelte:head>
	<title>{data.shareTitle} - {publicConfig.PUBLIC_APP_NAME}</title>
	<meta property="og:title" content="{data.shareTitle} - {publicConfig.PUBLIC_APP_NAME}" />
	<meta property="og:type" content="website" />
	<meta
		property="og:description"
		content="Check out this conversation on {publicConfig.PUBLIC_APP_NAME}"
	/>
	<meta property="og:image" content={data.ogImageUrl} />
	<meta property="og:image:alt" content={data.shareTitle} />
	<meta property="og:image:width" content="1200" />
	<meta property="og:image:height" content="648" />
	<meta
		property="og:url"
		content="{publicConfig.PUBLIC_ORIGIN || page.url.origin}{base}/r/{data.shareId}"
	/>
	<meta property="og:site_name" content={publicConfig.PUBLIC_APP_NAME} />
	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:title" content="{data.shareTitle} - {publicConfig.PUBLIC_APP_NAME}" />
	<meta
		name="twitter:description"
		content="Check out this conversation on {publicConfig.PUBLIC_APP_NAME}"
	/>
	<meta name="twitter:image" content={data.ogImageUrl} />
	<meta name="twitter:image:alt" content={data.shareTitle} />
</svelte:head>

<div class="flex h-full items-center justify-center">
	<div class="animate-pulse text-gray-400">Loading conversation...</div>
</div>
