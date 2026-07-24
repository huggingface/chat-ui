<script lang="ts">
	import { base } from "$app/paths";
	import { fade } from "svelte/transition";
	import Portal from "./Portal.svelte";
	import { useNotificationsStore } from "$lib/stores/notifications.svelte";
	import type { GenerationStatus } from "$lib/types/Generation";

	const notifications = useNotificationsStore();

	function label(status: GenerationStatus): string {
		if (status === "completed") return "Response ready";
		if (status === "interrupted") return "Generation stopped";
		return "Generation failed";
	}

	function dotClass(status: GenerationStatus): string {
		if (status === "completed") return "bg-green-500";
		if (status === "error") return "bg-red-500";
		return "bg-gray-400";
	}
</script>

<Portal>
	<div
		class="pointer-events-none fixed right-0 bottom-0 z-50 flex flex-col items-end gap-2 p-4 max-sm:text-sm"
	>
		{#each notifications.items as item (item.id)}
			<a
				href="{base}/conversation/{item.conversationId}"
				transition:fade|global={{ duration: 200 }}
				onclick={() => notifications.dismiss(item.id)}
				class="pointer-events-auto flex max-w-xs items-center gap-2 rounded-lg bg-white/95 px-3 py-2 text-sm text-gray-800 shadow-lg ring-1 ring-gray-200 hover:bg-white dark:bg-gray-800/95 dark:text-gray-100 dark:ring-gray-700"
			>
				<span class="size-2 flex-none rounded-full {dotClass(item.status)}"></span>
				<span class="min-w-0 truncate">
					<span class="font-semibold">{label(item.status)}</span>
					{#if item.title}
						<span class="text-gray-500 dark:text-gray-400">
							· <span class="first-letter:uppercase">{item.title}</span>
						</span>
					{/if}
				</span>
			</a>
		{/each}
	</div>
</Portal>
