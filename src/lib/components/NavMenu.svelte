<script lang="ts">
	import { base } from "$app/paths";
	import { createEventDispatcher } from "svelte";

	import Logo from "$lib/components/icons/Logo.svelte";
	import { switchTheme } from "$lib/switchTheme";
	import { isAborted } from "$lib/stores/isAborted";
	import { PUBLIC_APP_NAME, PUBLIC_ORIGIN } from "$env/static/public";
	import NavConversationItem from "./NavConversationItem.svelte";
	import type { LayoutData } from "../../routes/$types";

	const dispatch = createEventDispatcher<{
		shareConversation: { id: string; title: string };
		clickSettings: void;
		clickLogout: void;
	}>();

	interface Conv {
		id: string;
		title: string;
		updatedAt: Date;
	}
	export let conversations: Array<Conv> = [];

	export let canLogin: boolean;
	export let user: LayoutData["user"];

	function handleNewChatClick() {
		isAborted.set(true);
	}

	// group conversations based on conv.updatedAt property which is a date
	// it should have the following groups: "Today", "This week", "This month", "Older"

	$: groupedConversations = conversations.reduce(
		(acc: Record<string, Array<Conv>>, conv: Conv) => {
			const date = new Date(conv.updatedAt).valueOf();

			// get dates for today, a week ago, and a month ago:

			const today = new Date();
			const yesterday = new Date().setDate(today.getDate() - 1);
			const thisWeek = new Date().setDate(today.getDate() - 7);
			const thisMonth = new Date().setMonth(today.getMonth() - 1);

			// push date in the right group based on the date

			if (date > yesterday) {
				acc["Today"].push(conv);
			} else if (date > thisWeek) {
				acc["This week"].push(conv);
			} else if (date > thisMonth) {
				acc["This month"].push(conv);
			} else {
				acc["Older"].push(conv);
			}
			return acc;
		},
		{ Today: [], "This week": [], "This month": [], Older: [] }
	);
</script>

<div class="sticky top-0 flex flex-none items-center justify-between px-3 py-3.5 max-sm:pt-0">
	<a class="flex items-center rounded-xl text-lg font-semibold" href="{PUBLIC_ORIGIN}{base}/">
		<Logo classNames="mr-1" />
		{PUBLIC_APP_NAME}
	</a>
	<a
		href={`${base}/`}
		on:click={handleNewChatClick}
		class="flex rounded-lg border bg-white px-2 py-0.5 text-center shadow-sm hover:shadow-none dark:border-gray-600 dark:bg-gray-700"
	>
		New Chat
	</a>
</div>
<div
	class="scrollbar-custom flex flex-col gap-1 overflow-y-auto rounded-r-xl from-gray-50 px-3 pb-3 pt-2 dark:from-gray-800/30 max-sm:bg-gradient-to-t md:bg-gradient-to-l"
>
	{#each Object.entries(groupedConversations) as entry}
		{#if entry[1].length > 0}
			<h4 class="mb-1.5 mt-4 text-sm text-gray-400 first:mt-0 dark:text-gray-500">
				{entry[0]}
			</h4>
			{#each entry[1] as conv}
				<NavConversationItem on:editConversationTitle on:deleteConversation {conv} />
			{/each}
		{/if}
	{/each}
</div>
<div
	class="mt-0.5 flex flex-col gap-1 rounded-r-xl p-3 text-sm md:bg-gradient-to-l md:from-gray-50 md:dark:from-gray-800/30"
>
	{#if user?.username || user?.email}
		<form
			action="{base}/logout"
			method="post"
			class="group flex items-center gap-1.5 rounded-lg pl-2.5 pr-2 hover:bg-gray-100 dark:hover:bg-gray-700"
		>
			<span
				class="flex h-9 flex-none shrink items-center gap-1.5 truncate pr-2 text-gray-500 dark:text-gray-400"
				>{user?.username || user?.email}</span
			>
			<button
				type="submit"
				class="ml-auto h-6 flex-none items-center gap-1.5 rounded-md border bg-white px-2 text-gray-700 shadow-sm group-hover:flex hover:shadow-none dark:border-gray-600 dark:bg-gray-600 dark:text-gray-400 dark:hover:text-gray-300 md:hidden"
			>
				Sign Out
			</button>
		</form>
	{/if}
	{#if canLogin}
		<form action="{base}/login" method="POST" target="_parent">
			<button
				type="submit"
				class="flex h-9 w-full flex-none items-center gap-1.5 rounded-lg pl-2.5 pr-2 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
			>
				Login
			</button>
		</form>
	{/if}
	<button
		on:click={switchTheme}
		type="button"
		class="flex h-9 flex-none items-center gap-1.5 rounded-lg pl-2.5 pr-2 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
	>
		Theme
	</button>
	<button
		on:click={() => dispatch("clickSettings")}
		type="button"
		class="flex h-9 flex-none items-center gap-1.5 rounded-lg pl-2.5 pr-2 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
	>
		Settings
	</button>
	{#if PUBLIC_APP_NAME === "HuggingChat"}
		<a
			href="https://huggingface.co/spaces/huggingchat/chat-ui/discussions"
			target="_blank"
			rel="noreferrer"
			class="flex h-9 flex-none items-center gap-1.5 rounded-lg pl-2.5 pr-2 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
		>
			Feedback
		</a>
		<a
			href="{base}/privacy"
			class="flex h-9 flex-none items-center gap-1.5 rounded-lg pl-2.5 pr-2 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
		>
			About & Privacy
		</a>
	{/if}
</div>
