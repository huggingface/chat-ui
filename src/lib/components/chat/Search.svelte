<script lang="ts">
	import { onMount } from "svelte";
	import { page } from "$app/stores";
	import { base } from "$app/paths";
	import { differenceInHours } from "date-fns";
	import type { Conversation } from "$lib/types/Conversation";
	import NewChatIcon from "$lib/components/icons/NewChatIcon.svelte";
	import PopupChatIcon from "$lib/components/icons/PopupChatIcon.svelte";
	import XIcon from "$lib/components/icons/XIcon.svelte";
	import { isAborted } from "$lib/stores/isAborted";
	let searchQuery = "";
	let loading = false;
	let error: string = "";
	type ConversationInfo = {
		conversationId: string;
		title: string;
		content?: string;
	};
	let todayCons: ConversationInfo[] = [];
	let yesterdayCons: ConversationInfo[] = [];

	let conversations: Conversation[] = [];

	async function fetchConversations() {
		try {
			const response = await fetch(`${base}/api/conversations`);
			if (!response.ok) {
				throw new Error("Failed to fetch conversations");
			}
			conversations = await response.json();
		} catch (err) {
			error = err instanceof Error ? err.message : "An unknown error occurred";
		} finally {
			loading = false;
		}
	}

	function filterConversations(searchQuery: string = "") {
		todayCons = [];
		yesterdayCons = [];
		conversations.forEach((conversation) => {
			for (const message of conversation.messages) {
				if (
					message.content.toLowerCase().includes(searchQuery.toLowerCase()) &&
					message.content != ""
				) {
					if (differenceInHours(new Date(), new Date(conversation.updatedAt)) < 24) {
						todayCons.push({
							conversationId: conversation._id.toString(),
							title: conversation.title,
							content: message.content,
						});
					} else if (differenceInHours(new Date(), conversation.createdAt) < 48) {
						yesterdayCons.push({
							conversationId: conversation._id.toString(),
							title: conversation.title,
							content: message.content,
						});
					}
					break;
				}
			}
		});
		loading = false;
	}

	let popupWindowContainer: HTMLDivElement | null;

	function showPopup(e: KeyboardEvent) {
		if (e.ctrlKey && e.key === "k") {
			e.preventDefault();
			if (popupWindowContainer && popupWindowContainer.style.display === "none") {
				popupWindowContainer.style.display = "flex";
				fetchConversations();
				filterConversations();
			} else if (popupWindowContainer) {
				popupWindowContainer.style.display = "none";
			}
		}
	}

	onMount(() => {
		popupWindowContainer = document.querySelector(".popup-window-container");
		if (popupWindowContainer) {
			popupWindowContainer.style.display = "none";
		}
		window.addEventListener("keydown", showPopup);
		fetchConversations();
	});
</script>

<div
	class="popup-window-container absolute z-10 hidden h-[100%] w-[100%] items-center justify-center"
>
	<div
		class="popup z-2 w-[40rem] rounded-2xl border border-gray-700 bg-slate-900
		shadow-xl"
	>
		<div class="searchBar-container flex items-center p-5">
			<input
				placeholder="Search chats..."
				class="flex-1 bg-inherit outline-none"
				bind:value={searchQuery}
				oninput={(e) => {
					searchQuery = (e.target as HTMLInputElement).value;
					todayCons = [];
					yesterdayCons = [];
					loading = true;
					filterConversations(searchQuery);
				}}
			/>
			<button
				onclick={() => {
					if (popupWindowContainer) {
						popupWindowContainer.style.display = "none";
					}
				}}
			>
				<XIcon classNames="cursor-pointer hover:bg-gray-700 rounded-full" />
			</button>
		</div>
		<div class="border-b-2 border-gray-700"></div>
		<div class="chat-container relative flex h-[25rem] flex-col gap-2 overflow-y-scroll p-5">
			<a
				href={`${base}/`}
				onclick={() => {
					isAborted.set(true);
				}}
				class="flex cursor-pointer flex-row gap-3 rounded-lg p-2 font-[1rem] text-[#FFFFFF] transition-colors
			duration-150 ease-in-out hover:bg-slate-800"
			>
				<NewChatIcon />
				<span>New chat</span>
			</a>
			{#if loading}
				<p>Loading...</p>
			{:else if error}
				<p>Error: {error}</p>
			{:else if yesterdayCons.length > 0 || todayCons.length > 0}
				{#if todayCons.length > 0}
					<ul class="chats today-chats flex flex-col gap-2">
						<span class="p-2">Today</span>
						{#each todayCons as convInfo}
							<div
								class="flex cursor-pointer flex-row items-center gap-3 rounded-lg p-2 transition-colors
                duration-150 ease-in-out hover:bg-slate-800"
								id={convInfo.conversationId}
								onclick={() => {
									window.location.href = `${base}/conversation/${convInfo.conversationId}`;
								}}
							>
								<PopupChatIcon />
								<div class="flex flex-col">
									<h1>{convInfo.title}</h1>
									<span>{convInfo.content}</span>
								</div>
							</div>
						{/each}
					</ul>
				{/if}
				{#if yesterdayCons.length > 0}
					<ui class="chats yesterday-chats flex flex-col gap-2">
						<span class="p-2">Yesterday</span>
						{#each yesterdayCons as convInfo}
							<div
								class="flex cursor-pointer flex-row items-center gap-3 rounded-lg p-2 transition-colors
			duration-150 ease-in-out hover:bg-slate-800"
								id={convInfo.conversationId}
							>
								<PopupChatIcon />
								<div class="flex flex-col">
									<h1>{convInfo.title}</h1>
									<span>{convInfo.content}</span>
								</div>
							</div>
						{/each}
					</ui>
				{/if}
			{:else}
				<p>No conversations found.</p>
			{/if}
		</div>
	</div>
</div>

<style lang="postcss">
	.chat-container::-webkit-scrollbar-thumb {
		background-color: #7775;
		border-radius: 0.5em;
	}

	.chat-container::-webkit-scrollbar-thumb:hover {
		background-color: #777;
	}

	.chat-container::-webkit-scrollbar {
		width: 10px;
	}

	.chat-container::-webkit-scrollbar-track {
		background-color: #5555;
		margin-block: 1.25em;
		border-radius: 0.5em;
	}
	.chat-container > div,
	.chats div {
	}
</style>
