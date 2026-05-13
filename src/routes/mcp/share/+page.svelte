<script lang="ts">
	import { goto } from "$app/navigation";
	import { base } from "$app/paths";
	import { page } from "$app/state";
	import { usePublicConfig } from "$lib/utils/PublicConfig.svelte";
	import { addCustomServer } from "$lib/stores/mcpServers";
	import IconMCP from "$lib/components/icons/IconMCP.svelte";
	import IconWarning from "~icons/carbon/warning";
	import { getMcpServerFaviconUrl } from "$lib/utils/favicon";

	let { data } = $props();
	const publicConfig = usePublicConfig();

	let isAdding = $state(false);

	const ogTitle = $derived(
		data.invalid
			? `Invalid MCP server link - ${publicConfig.PUBLIC_APP_NAME}`
			: `Add ${data.name} to ${publicConfig.PUBLIC_APP_NAME}`
	);
	const ogDescription = $derived(
		data.invalid
			? "This MCP server share link is missing or invalid."
			: `Someone shared the MCP server "${data.name}" with you. Review and add it to ${publicConfig.PUBLIC_APP_NAME}.`
	);
	const ogImage = $derived(
		`${publicConfig.PUBLIC_ORIGIN || page.url.origin}${publicConfig.assetPath}/thumbnail.png`
	);

	function handleAdd() {
		if (data.invalid || !data.url || isAdding) return;
		isAdding = true;
		addCustomServer({ name: data.name, url: data.url });
		goto(`${base}/`, { invalidateAll: true });
	}

	function handleCancel() {
		goto(`${base}/`);
	}
</script>

<svelte:head>
	<title>{ogTitle}</title>
	<meta name="description" content={ogDescription} />
	<meta property="og:title" content={ogTitle} />
	<meta property="og:description" content={ogDescription} />
	<meta property="og:type" content="website" />
	<meta property="og:url" content={page.url.href} />
	<meta property="og:image" content={ogImage} />
	<meta property="og:site_name" content={publicConfig.PUBLIC_APP_NAME} />
	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:title" content={ogTitle} />
	<meta name="twitter:description" content={ogDescription} />
	<meta name="twitter:image" content={ogImage} />
</svelte:head>

<div class="flex min-h-dvh w-full items-center justify-center bg-gray-50 p-4 dark:bg-gray-900">
	<div
		class="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-800"
	>
		<div class="mb-4 flex items-center gap-3">
			<div class="flex size-12 items-center justify-center rounded-xl bg-blue-500/10">
				<IconMCP classNames="size-7 text-blue-600 dark:text-blue-500" />
			</div>
			<div>
				<h1 class="text-lg font-semibold text-gray-900 dark:text-gray-100">Add MCP server</h1>
				<p class="text-xs text-gray-600 dark:text-gray-400">
					Shared with you on {publicConfig.PUBLIC_APP_NAME}
				</p>
			</div>
		</div>

		{#if data.invalid}
			<div
				class="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-200"
			>
				This share link is missing or invalid. Ask the sender for a new link.
			</div>
			<div class="flex justify-end">
				<button
					type="button"
					onclick={handleCancel}
					class="rounded-lg bg-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
				>
					Back to {publicConfig.PUBLIC_APP_NAME}
				</button>
			</div>
		{:else}
			<div class="mb-4 rounded-lg border border-gray-200 p-4 dark:border-gray-700">
				<div class="mb-2 flex items-center gap-2">
					<img
						src={getMcpServerFaviconUrl(data.url ?? "")}
						alt=""
						class="size-4 flex-shrink-0 rounded"
					/>
					<p class="truncate font-semibold text-gray-900 dark:text-gray-100">{data.name}</p>
				</div>
				<p class="break-all text-xs text-gray-600 dark:text-gray-400">{data.url}</p>
			</div>

			<div
				class="mb-5 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900 dark:border-yellow-900/40 dark:bg-yellow-900/20 dark:text-yellow-100"
			>
				<IconWarning class="mt-0.5 size-4 flex-none text-amber-600 dark:text-yellow-300" />
				<div class="text-[13px] leading-5">
					<p class="font-medium">Only add servers you trust.</p>
					<p class="mt-1 text-amber-800 dark:text-yellow-100/90">
						This server will receive your requests, including conversation context, and can run
						tools on your behalf. Review the URL above before continuing. Any required
						authentication headers can be added after install.
					</p>
				</div>
			</div>

			<div class="flex justify-end gap-2">
				<button
					type="button"
					onclick={handleCancel}
					class="rounded-lg bg-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
				>
					Cancel
				</button>
				<button
					type="button"
					onclick={handleAdd}
					disabled={isAdding}
					class="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
				>
					{isAdding ? "Adding…" : "Add to MCP"}
				</button>
			</div>
		{/if}
	</div>
</div>
