<script lang="ts">
	import { goto } from "$app/navigation";
	import { base } from "$app/paths";
	import { page } from "$app/state";
	import { usePublicConfig } from "$lib/utils/PublicConfig.svelte";
	import { addCustomServer } from "$lib/stores/mcpServers";
	import Modal from "$lib/components/Modal.svelte";
	import AddServerForm from "$lib/components/mcp/AddServerForm.svelte";
	import type { KeyValuePair } from "$lib/types/Tool";

	let { data } = $props();
	const publicConfig = usePublicConfig();

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

	function close() {
		goto(`${base}/`);
	}

	function handleSubmit(server: { name: string; url: string; headers?: KeyValuePair[] }) {
		addCustomServer(server);
		goto(`${base}/`, { invalidateAll: true });
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

<Modal width="w-[600px]" onclose={close} closeButton>
	<div class="p-6">
		<div class="mb-6">
			<h2 class="mb-1 text-xl font-semibold text-gray-900 dark:text-gray-200">Add MCP server</h2>
			<p class="text-sm text-gray-600 dark:text-gray-400">
				{#if data.invalid}
					This share link is missing or invalid. Ask the sender for a new one.
				{:else}
					Someone shared this server with you. Review the details before adding it to {publicConfig.PUBLIC_APP_NAME}.
				{/if}
			</p>
		</div>

		{#if !data.invalid && data.url}
			<AddServerForm
				initialName={data.name}
				initialUrl={data.url}
				onsubmit={handleSubmit}
				oncancel={close}
			/>
		{:else}
			<div class="flex justify-end">
				<button
					type="button"
					onclick={close}
					class="rounded-lg bg-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
				>
					Back to {publicConfig.PUBLIC_APP_NAME}
				</button>
			</div>
		{/if}
	</div>
</Modal>
