<script lang="ts">
	import ToolLogo from "./ToolLogo.svelte";
	import { base } from "$app/paths";
	import { browser } from "$app/environment";

	export let toolId: string;
</script>

<div
	class="relative flex items-center justify-center space-x-2 rounded border border-gray-300 bg-gray-200 px-2 py-1"
>
	{#if browser}
		{#await fetch(`${base}/api/tools/${toolId}`).then((res) => res.json()) then value}
			<ToolLogo color={value.color} icon={value.icon} size="sm" />
			<div class="flex flex-col items-center justify-center py-1">
				<a
					href={`${base}/tools/${value._id}`}
					target="_blank"
					class="line-clamp-1 truncate font-semibold text-blue-600 hover:underline"
					>{value.displayName}</a
				>
				{#if value.createdByName}
					<p class="text-center text-xs text-gray-500">
						Created by
						<a class="underline" href="{base}/tools?user={value.createdByName}" target="_blank"
							>{value.createdByName}</a
						>
					</p>
				{:else}
					<p class="text-center text-xs text-gray-500">Official HuggingChat tool</p>
				{/if}
			</div>
		{/await}
	{/if}
</div>
