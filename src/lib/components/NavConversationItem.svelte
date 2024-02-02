<script lang="ts">
	import { base } from "$app/paths";
	import { page } from "$app/stores";
	import { createEventDispatcher } from "svelte";

	import CarbonCheckmark from "~icons/carbon/checkmark";
	import CarbonTrashCan from "~icons/carbon/trash-can";
	import CarbonClose from "~icons/carbon/close";
	import CarbonEdit from "~icons/carbon/edit";
	import type { ConvSidebar } from "$lib/types/ConvSidebar";

	export let conv: ConvSidebar;

	let confirmDelete = false;

	const dispatch = createEventDispatcher<{
		deleteConversation: string;
		editConversationTitle: { id: string; title: string };
	}>();
</script>

<a
	data-sveltekit-noscroll
	on:mouseleave={() => {
		confirmDelete = false;
	}}
	href="{base}/conversation/{conv.id}"
	class="group flex h-10 flex-none items-center gap-1.5 rounded-lg pl-2.5 pr-2 text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700 {conv.id ===
	$page.params.id
		? 'bg-gray-100 dark:bg-gray-700'
		: ''}"
>
	<div class="flex flex-1 items-center truncate">
		{#if confirmDelete}
			<span class="mr-1 font-semibold"> Delete </span>
		{/if}
		{#if conv.avatarHash}
			<img
				src="{base}/settings/assistants/{conv.assistantId}/avatar.jpg?hash={conv.avatarHash}"
				alt="Assistant avatar"
				class="mr-1.5 inline size-4 flex-none rounded-full object-cover"
			/>
			{conv.title.replace(/\p{Emoji}/gu, "")}
		{:else if conv.assistantId}
			<div
				class="mr-1.5 flex size-4 flex-none items-center justify-center rounded-full bg-gray-300 text-xs font-bold uppercase text-gray-500"
			/>
			{conv.title.replace(/\p{Emoji}/gu, "")}
		{:else}
			{conv.title}
		{/if}
	</div>

	{#if confirmDelete}
		<button
			type="button"
			class="flex h-5 w-5 items-center justify-center rounded md:hidden md:group-hover:flex"
			title="Confirm delete action"
			on:click|preventDefault={() => {
				confirmDelete = false;
				dispatch("deleteConversation", conv.id);
			}}
		>
			<CarbonCheckmark class="text-xs text-gray-400 hover:text-gray-500 dark:hover:text-gray-300" />
		</button>
		<button
			type="button"
			class="flex h-5 w-5 items-center justify-center rounded md:hidden md:group-hover:flex"
			title="Cancel delete action"
			on:click|preventDefault={() => (confirmDelete = false)}
		>
			<CarbonClose class="text-xs text-gray-400 hover:text-gray-500 dark:hover:text-gray-300" />
		</button>
	{:else}
		<button
			type="button"
			class="flex h-5 w-5 items-center justify-center rounded md:hidden md:group-hover:flex"
			title="Edit conversation title"
			on:click|preventDefault={() => {
				const newTitle = prompt("Edit this conversation title:", conv.title);
				if (!newTitle) return;
				dispatch("editConversationTitle", { id: conv.id, title: newTitle });
			}}
		>
			<CarbonEdit class="text-xs text-gray-400 hover:text-gray-500 dark:hover:text-gray-300" />
		</button>

		<button
			type="button"
			class="flex h-5 w-5 items-center justify-center rounded md:hidden md:group-hover:flex"
			title="Delete conversation"
			on:click|preventDefault={(event) => {
				if (event.shiftKey) {
					dispatch("deleteConversation", conv.id);
				} else {
					confirmDelete = true;
				}
			}}
		>
			<CarbonTrashCan class="text-xs text-gray-400  hover:text-gray-500 dark:hover:text-gray-300" />
		</button>
	{/if}
</a>
