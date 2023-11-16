<script lang="ts">
	import { base } from "$app/paths";
	import { createEventDispatcher } from "svelte";

	import Logo from "$lib/components/icons/Logo.svelte";
	import { switchTheme } from "$lib/switchTheme";
	import { PUBLIC_APP_NAME, PUBLIC_ORIGIN } from "$env/static/public";
	import NavConversationItem from "./NavConversationItem.svelte";
	import type { LayoutData } from "../../routes/$types";

	const dispatch = createEventDispatcher<{
		shareConversation: { id: string; title: string };
		clickSettings: void;
		clickLogout: void;
	}>();

	export let conversations: Array<{
		id: string;
		title: string;
	}> = [];

	export let canLogin: boolean;
	export let user: LayoutData["user"];
</script>

<div class="sticky top-0 flex flex-none items-center justify-between px-3 py-3.5 max-sm:pt-0">
	<div class="flex items-center h-10 w-20">
		<Logo classNames="mr-1" />
		<!-- {"chat ui"} -->
	</div>
	<a
		href={`${base}/`}
		class="flex rounded-lg border border-gray-200 bg-white px-2 py-0.5 text-center shadow-sm hover:shadow-none text-gray-500 hover:bg-gray-100"
	>
		New Chat
	</a>
</div>
<div
	class="scrollbar-custom flex flex-col gap-1 overflow-y-auto rounded-r-xl  px-3 pb-3 pt-2"
>
	{#each conversations as conv (conv.id)}
		<NavConversationItem on:editConversationTitle on:deleteConversation {conv} />
	{/each}
</div>
<div
	class="mt-0.5 flex flex-col gap-1 rounded-r-xl bg-gradient-to-l from-gray-50 p-3 text-sm"
>
	{#if user?.username || user?.email}
		<form
			action="{base}/logout"
			method="post"
			class="group flex items-center gap-1.5 rounded-lg pl-3 pr-2 hover:bg-gray-100"
		>
			<span
				class="flex h-9 flex-none shrink items-center gap-1.5 truncate pr-2 text-gray-500"
				>{user?.username || user?.email}</span
			>
			<button
				type="submit"
				class="ml-auto h-6 flex-none items-center gap-1.5 rounded-md border bg-white px-2 text-gray-700 shadow-sm group-hover:flex hover:shadow-none md:hidden"
			>
				Sign Out
			</button>
		</form>
	{/if}
	{#if canLogin}
		<form action="{base}/login" method="POST" target="_parent">
			<button
				type="submit"
				class="flex h-9 w-full flex-none items-center gap-1.5 rounded-lg pl-3 pr-2 text-gray-500 hover:bg-gray-100"
			>
				Login
			</button>
		</form>
	{/if}
	<!-- <button
		on:click={switchTheme}
		type="button"
		class="flex h-9 flex-none items-center gap-1.5 rounded-lg pl-3 pr-2 text-gray-500 hover:bg-gray-100"
	>
		Theme
	</button> 
	<button
		on:click={() => dispatch("clickSettings")}
		type="button"
		class="flex h-9 flex-none items-center gap-1.5 rounded-lg pl-3 pr-2 text-gray-500 hover:bg-gray-100"
	>
		Settings
	</button> -->
	{#if PUBLIC_APP_NAME === "HuggingChat"}
		<a
			href="https://huggingface.co/spaces/huggingchat/chat-ui/discussions"
			target="_blank"
			rel="noreferrer"
			class="flex h-9 flex-none items-center gap-1.5 rounded-lg pl-3 pr-2 text-gray-500 hover:bg-gray-100"
		>
			Feedback
		</a>
		<a
			href="{base}/privacy"
			class="flex h-9 flex-none items-center gap-1.5 rounded-lg pl-3 pr-2 text-gray-500 hover:bg-gray-100"
		>
			About & Privacy
		</a>
	{/if}
</div>
