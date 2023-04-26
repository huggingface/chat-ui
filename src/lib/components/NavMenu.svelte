<script lang="ts">
	import { base } from "$app/paths";
	import { page } from "$app/stores";
	import { createEventDispatcher } from "svelte";

	import Logo from "$lib/components/icons/Logo.svelte";
	import CarbonTrashCan from "~icons/carbon/trash-can";
	import CarbonExport from "~icons/carbon/export";

	import { switchTheme } from "$lib/switchTheme";
	import { PUBLIC_ORIGIN } from "$env/static/public";

	const dispatch = createEventDispatcher<{
		shareConversation: { id: string; title: string };
		deleteConversation: string;
	}>();

	export let conversations: Array<{
		id: string;
		title: string;
	}> = [];
</script>

<div class="sticky top-0 flex flex-none items-center justify-between px-3 py-3.5 max-sm:pt-0">
	<a class="flex items-center rounded-xl text-lg font-semibold" href="{PUBLIC_ORIGIN}{base}/">
		<Logo classNames="mr-1 text-3xl" />
		HuggingChat
	</a>
	<a
		href={base || "/"}
		class="flex rounded-lg border bg-white px-2 py-0.5 text-center shadow-sm hover:shadow-none dark:border-gray-600 dark:bg-gray-700"
	>
		New Chat
	</a>
</div>
<div
	class="scrollbar-custom flex flex-col gap-1 overflow-y-auto rounded-r-xl bg-gradient-to-l from-gray-50  px-3 pb-3 pt-2 dark:from-gray-800/30"
>
	{#each conversations as conv}
		<a
			data-sveltekit-noscroll
			href="{base}/conversation/{conv.id}"
			class="group flex h-11 flex-none items-center gap-1.5 rounded-lg pl-3 pr-2 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700 {conv.id ===
			$page.params.id
				? 'bg-gray-100 dark:bg-gray-700'
				: ''}"
		>
			<div class="flex-1 truncate">{conv.title}</div>

			<button
				type="button"
				class="flex h-5 w-5 items-center justify-center rounded md:hidden  md:group-hover:flex"
				title="Share conversation"
				on:click|preventDefault={() =>
					dispatch("shareConversation", { id: conv.id, title: conv.title })}
			>
				<CarbonExport class="text-xs text-gray-400  hover:text-gray-500 dark:hover:text-gray-300" />
			</button>

			<button
				type="button"
				class="flex h-5 w-5 items-center justify-center rounded md:hidden md:group-hover:flex"
				title="Delete conversation"
				on:click|preventDefault={() => dispatch("deleteConversation", conv.id)}
			>
				<CarbonTrashCan
					class="text-xs text-gray-400  hover:text-gray-500 dark:hover:text-gray-300"
				/>
			</button>
		</a>
	{/each}
</div>
<div
	class="mt-0.5 flex flex-col gap-2 rounded-r-xl bg-gradient-to-l from-gray-50 p-3 text-sm dark:from-gray-800/30"
>
	<button
		on:click={switchTheme}
		type="button"
		class="group flex h-9 flex-none items-center gap-1.5 rounded-lg pl-3 pr-2 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
	>
		Theme
	</button>
	<a
		href="https://huggingface.co/spaces/huggingchat/chat-ui/discussions"
		target="_blank"
		rel="noreferrer"
		class="group flex h-9 flex-none items-center gap-1.5 rounded-lg pl-3 pr-2 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
	>
		Feedback
	</a>
	<a
		href="{base}/privacy"
		class="group flex h-9 flex-none items-center gap-1.5 rounded-lg pl-3 pr-2 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
	>
		About & Privacy
	</a>
</div>
