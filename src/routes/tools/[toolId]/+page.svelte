<script lang="ts">
	import { afterNavigate, goto } from "$app/navigation";
	import { base } from "$app/paths";
	import Modal from "$lib/components/Modal.svelte";

	export let data;

	let previousPage: string = base;

	afterNavigate(({ from }) => {
		if (!from?.url.pathname.includes("settings")) {
			previousPage = from?.url.toString() || previousPage;
		}
	});
</script>

<Modal on:close={() => goto(previousPage)}>
	<div class="w-full min-w-64 p-4">
		<span class="mb-1 text-sm font-semibold">{data.tool.displayName}</span>
		<p class="text-sm text-gray-500">{data.tool.description}</p>
		{#if data.tool.type === "community"}
			<p class="text-sm text-gray-500">
				Created by <a class="hover:underline" href="{base}/tools?user={data.tool.createdByName}">
					{data.tool.createdByName}
				</a>
			</p>
			<a
				href="{base}/tools/{data.tool._id.toString()}/edit"
				class="mt-2 inline-flex items-center gap-1.5 rounded-full border border-gray-300 bg-gray-50 px-3 py-1 text-sm text-gray-500 hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300"
			>
				Edit
			</a>
		{/if}
	</div>
</Modal>
