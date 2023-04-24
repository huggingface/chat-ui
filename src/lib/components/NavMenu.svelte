<script lang="ts">
	import { base } from "$app/paths";
	import { page } from "$app/stores";
	import { createEventDispatcher } from "svelte";

	import CarbonTrashCan from "~icons/carbon/trash-can";
	import CarbonExport from "~icons/carbon/export";
	import { switchTheme } from "$lib/switchTheme";

	const dispatch = createEventDispatcher<{
		shareConversation: { id: string; title: string };
		deleteConversation: string;
	}>();

	export let conversations: Array<{
		id: string;
		title: string;
	}> = [];
</script>

<div class="flex-none sticky top-0 p-3 flex flex-col">
	<a
		href={base || "/"}
		class="border px-12 py-2.5 rounded-lg shadow bg-white dark:bg-gray-700 dark:border-gray-600 text-center"
	>
		New Chat
	</a>
</div>
<div class="flex flex-col overflow-y-auto p-3 -mt-3 gap-1">
	{#each conversations as conv}
		<a
			data-sveltekit-noscroll
			href="{base}/conversation/{conv.id}"
			class="group pl-3 pr-2 h-11 rounded-lg flex-none text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-1.5 {conv.id ===
			$page.params.id
				? 'bg-gray-100 dark:bg-gray-700'
				: ''}"
		>
			<div class="flex-1 truncate">{conv.title}</div>

			<button
				type="button"
				class="flex md:hidden md:group-hover:flex w-5 h-5 items-center justify-center  rounded"
				title="Share conversation"
				on:click|preventDefault={() =>
					dispatch("shareConversation", { id: conv.id, title: conv.title })}
			>
				<CarbonExport class="text-gray-400 hover:text-gray-500  dark:hover:text-gray-300 text-xs" />
			</button>

			<button
				type="button"
				class="flex md:hidden md:group-hover:flex w-5 h-5 items-center justify-center rounded"
				title="Delete conversation"
				on:click|preventDefault={() => dispatch("deleteConversation", conv.id)}
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
		href="https://huggingface.co/spaces/huggingchat/chat-ui/discussions"
		class="text-left flex items-center first-letter:capitalize truncate py-3 px-3 rounded-lg flex-none text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
	>
		Community feedback
	</a>
	<a
		href={base}
		class="truncate py-3 px-3 rounded-lg flex-none text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
	>
		Settings
	</a>
</div>
