<script lang="ts">
	import { base } from "$app/paths";
	import { page, navigating } from "$app/stores";

	import CarbonClose from "~icons/carbon/close";
	import CarbonTrashCan from "~icons/carbon/trash-can";
	import CarbonExport from "~icons/carbon/export";
	import { switchTheme } from "$lib/switchTheme";

	export let isOpen = false;
	export let onClose = () => (isOpen = false);
	export let data: any;

	// TODO: refactor this to be action creators maybe instead of props
	export let shareConversation: any;
	export let deleteConversation: any;

	$: if ($navigating) {
		onClose();
	}
</script>

<nav
	class="fixed inset-0 z-50 grid grid-rows-[auto,auto,1fr,auto] grid-cols-1 max-h-screen bg-white dark:bg-gray-900 bg-gradient-to-l from-gray-50 dark:from-gray-800/30 {isOpen
		? 'block'
		: 'hidden'}"
>
	<div class="flex items-center px-4 h-12">
		<button
			type="button"
			class="flex items-center justify-center ml-auto w-9 h-9 -mr-3"
			on:click={onClose}><CarbonClose /></button
		>
	</div>
	<div class="flex-none sticky top-0 p-3 flex flex-col">
		<a
			href={base || "/"}
			class="border px-12 py-2.5 rounded-lg shadow bg-white dark:bg-gray-700 dark:border-gray-600 text-center"
		>
			New Chat
		</a>
	</div>
	<div class="flex flex-col overflow-y-auto p-3 -mt-3 gap-1">
		{#each data.conversations as conv}
			<a
				data-sveltekit-noscroll
				href="{base}/conversation/{conv.id}"
				class="pl-3 pr-2 h-12 rounded-lg flex-none text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-1.5 {conv.id ===
				$page.params.id
					? 'bg-gray-100 dark:bg-gray-700'
					: ''}"
			>
				<div class="flex-1 truncate">azeza aze a ea zeazeazazeae</div>

				<button
					type="button"
					class="w-5 h-5 items-center justify-center flex rounded"
					title="Share conversation"
					on:click|preventDefault={() => shareConversation(conv.id, conv.title)}
				>
					<CarbonExport
						class="text-gray-400 hover:text-gray-500  dark:hover:text-gray-300 text-xs"
					/>
				</button>

				<button
					type="button"
					class="w-5 h-5 items-center justify-center flex rounded"
					title="Delete conversation"
					on:click|preventDefault={() => deleteConversation(conv.id)}
				>
					<CarbonTrashCan
						class="text-gray-400 hover:text-gray-500  dark:hover:text-gray-300 text-xs"
					/>
				</button>
			</a>
		{/each}
	</div>
	<div class="flex flex-col p-3 gap-2">
		<button
			on:click={switchTheme}
			type="button"
			class="text-left flex items-center first-letter:capitalize truncate py-3 px-3 rounded-lg flex-none text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
		>
			Theme
		</button>
		<a
			href={base}
			class="truncate py-3 px-3 rounded-lg flex-none text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
		>
			Settings
		</a>
	</div>
</nav>
