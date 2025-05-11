<script lang="ts">
	import { onMount } from "svelte";
	import { page } from "$app/stores";
	import { differenceInHours } from "date-fns";
	import type { Conversation } from "$lib/types/Conversation";
	let searchQuery = "";
	let loading = false;
	let error = null;
	type ConversationInfo = {
		conversationId: string;
		title: string;
		content?: string;
	};

	let conversations: Conversation[] = [];

	async function fetchConversations() {
		try {
			const response = await fetch(`/api/conversations/${$page.params.userID}`);
			if (!response.ok) {
				throw new Error("Failed to fetch conversations");
			}
			conversations = await response.json();
			filterConversations();
		} catch (err) {
			error = err instanceof Error ? err.message : "An unknown error occurred";
		} finally {
			loading = false;
		}
	}
		function filterConversations() {
		searchQuery = "";
		conversations.forEach((conversation) => {
			for (const message of conversation.messages) {
				if (message.content.toLowerCase().includes(searchQuery.toLowerCase())) {
					if (differenceInHours(new Date(), conversation.createdAt) < 24) {
						todayCons.push({
							conversationId: conversation._id.toString(),
							title: conversation.title,
							content: searchQuery !== "" ? message.content : "",
						});
					} else if (differenceInHours(new Date(), conversation.createdAt) < 48) {
						yesterdayCons.push({
							conversationId: conversation._id.toString(),
							title: conversation.title,
							content: searchQuery !== "" ? message.content : "",
						});
					}
					break;
				}
			}
		});
	}

	function handleSearch() {
		filterConversations();
	}
	
	let todayCons: ConversationInfo[] = [
		{
			conversationId: "1",
			title: "Chat 1",
			content: "This is the first chat message.",
		},
		{
			conversationId: "1",
			title: "Chat 1",
			content: "This is the first chat message.",
		},
		{
			conversationId: "1",
			title: "Chat 1",
			content: "",
		},
	];
	let yesterdayCons: ConversationInfo[] = [
		{
			conversationId: "1",
			title: "Chat 1",
			content: "This is the first chat message.",
		},
		{
			conversationId: "1",
			title: "Chat 1",
			content: "This is the first chat message.",
		},
		{
			conversationId: "1",
			title: "Chat 1",
			content: "",
		},
	];
	let popupWindowContainer: HTMLDivElement | null;

	function showPopup(e: KeyboardEvent) {
		if (e.ctrlKey && e.key === "k") {
			e.preventDefault();
			if (popupWindowContainer && popupWindowContainer.style.display === "none") {
				popupWindowContainer.style.display = "flex";
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
	});
</script>

<div
	class="popup-window-container absolute z-10 hidden h-[100%] w-[100%] items-center justify-center"
>
	<div
		class="popup z-2 w-[40rem] rounded-2xl border border-gray-700 bg-slate-900
		shadow-xl"
	>
		<div class="searchBar-container p-5">
			<input
				placeholder="Search chats..."
				class="bg-inherit outline-none"
				bind:value={searchQuery}
				on:input={handleSearch}
			/>
		</div>
		<div class="border-b-2 border-gray-700"></div>
		<div class="chat-container relative flex h-[25rem] flex-col gap-2 overflow-y-scroll p-5">
			<div
				class="flex cursor-pointer flex-row gap-3 rounded-lg p-2 font-[1rem] text-[#FFFFFF] transition-colors
			duration-150 ease-in-out hover:bg-slate-800"
			>
				<svg
					width="24"
					height="24"
					viewBox="0 0 24 24"
					fill="currentColor"
					xmlns="http://www.w3.org/2000/svg"
					class="icon-sidebar text-token-text-secondary"
					><path
						d="M15.6729 3.91287C16.8918 2.69392 18.8682 2.69392 20.0871 3.91287C21.3061 5.13182 21.3061 7.10813 20.0871 8.32708L14.1499 14.2643C13.3849 15.0293 12.3925 15.5255 11.3215 15.6785L9.14142 15.9899C8.82983 16.0344 8.51546 15.9297 8.29289 15.7071C8.07033 15.4845 7.96554 15.1701 8.01005 14.8586L8.32149 12.6785C8.47449 11.6075 8.97072 10.615 9.7357 9.85006L15.6729 3.91287ZM18.6729 5.32708C18.235 4.88918 17.525 4.88918 17.0871 5.32708L11.1499 11.2643C10.6909 11.7233 10.3932 12.3187 10.3014 12.9613L10.1785 13.8215L11.0386 13.6986C11.6812 13.6068 12.2767 13.3091 12.7357 12.8501L18.6729 6.91287C19.1108 6.47497 19.1108 5.76499 18.6729 5.32708ZM11 3.99929C11.0004 4.55157 10.5531 4.99963 10.0008 5.00007C9.00227 5.00084 8.29769 5.00827 7.74651 5.06064C7.20685 5.11191 6.88488 5.20117 6.63803 5.32695C6.07354 5.61457 5.6146 6.07351 5.32698 6.63799C5.19279 6.90135 5.10062 7.24904 5.05118 7.8542C5.00078 8.47105 5 9.26336 5 10.4V13.6C5 14.7366 5.00078 15.5289 5.05118 16.1457C5.10062 16.7509 5.19279 17.0986 5.32698 17.3619C5.6146 17.9264 6.07354 18.3854 6.63803 18.673C6.90138 18.8072 7.24907 18.8993 7.85424 18.9488C8.47108 18.9992 9.26339 19 10.4 19H13.6C14.7366 19 15.5289 18.9992 16.1458 18.9488C16.7509 18.8993 17.0986 18.8072 17.362 18.673C17.9265 18.3854 18.3854 17.9264 18.673 17.3619C18.7988 17.1151 18.8881 16.7931 18.9393 16.2535C18.9917 15.7023 18.9991 14.9977 18.9999 13.9992C19.0003 13.4469 19.4484 12.9995 20.0007 13C20.553 13.0004 21.0003 13.4485 20.9999 14.0007C20.9991 14.9789 20.9932 15.7808 20.9304 16.4426C20.8664 17.116 20.7385 17.7136 20.455 18.2699C19.9757 19.2107 19.2108 19.9756 18.27 20.455C17.6777 20.7568 17.0375 20.8826 16.3086 20.9421C15.6008 21 14.7266 21 13.6428 21H10.3572C9.27339 21 8.39925 21 7.69138 20.9421C6.96253 20.8826 6.32234 20.7568 5.73005 20.455C4.78924 19.9756 4.02433 19.2107 3.54497 18.2699C3.24318 17.6776 3.11737 17.0374 3.05782 16.3086C2.99998 15.6007 2.99999 14.7266 3 13.6428V10.3572C2.99999 9.27337 2.99998 8.39922 3.05782 7.69134C3.11737 6.96249 3.24318 6.3223 3.54497 5.73001C4.02433 4.7892 4.78924 4.0243 5.73005 3.54493C6.28633 3.26149 6.88399 3.13358 7.55735 3.06961C8.21919 3.00673 9.02103 3.00083 9.99922 3.00007C10.5515 2.99964 10.9996 3.447 11 3.99929Z"
						fill="currentColor"
					></path></svg
				>
				<span>New chat</span>
			</div>
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
								class="flex cursor-pointer flex-row gap-3 rounded-lg p-2 transition-colors duration-150
                ease-in-out hover:bg-slate-800 items-center"
								id={convInfo.conversationId}
							>
								<svg
									width="24"
									height="24"
									viewBox="0 0 24 24"
									fill="none"
									xmlns="http://www.w3.org/2000/svg"
									class="icon-sidebar text-token-text-secondary"
									><path
										fill-rule="evenodd"
										clip-rule="evenodd"
										d="M8.52242 6.53608C9.7871 4.41979 12.1019 3 14.75 3C18.7541 3 22 6.24594 22 10.25C22 11.9007 21.4474 13.4239 20.5183 14.6425L21.348 15.97C21.5407 16.2783 21.5509 16.6668 21.3746 16.9848C21.1984 17.3027 20.8635 17.5 20.5 17.5H15.4559C14.1865 19.5963 11.883 21 9.25 21C9.18896 21 9.12807 20.9992 9.06735 20.9977C9.04504 20.9992 9.02258 21 9 21H3.5C3.13647 21 2.80158 20.8027 2.62536 20.4848C2.44913 20.1668 2.45933 19.7783 2.652 19.47L3.48171 18.1425C2.55263 16.9239 2 15.4007 2 13.75C2 9.99151 4.85982 6.90116 8.52242 6.53608ZM10.8938 6.68714C14.106 7.43177 16.5 10.3113 16.5 13.75C16.5 14.3527 16.4262 14.939 16.2871 15.5H18.6958L18.435 15.0828C18.1933 14.6961 18.2439 14.1949 18.5579 13.8643C19.4525 12.922 20 11.651 20 10.25C20 7.3505 17.6495 5 14.75 5C13.2265 5 11.8535 5.64888 10.8938 6.68714ZM8.89548 19C8.94178 18.9953 8.98875 18.9938 9.03611 18.9957C9.107 18.9986 9.17831 19 9.25 19C11.3195 19 13.1112 17.8027 13.9668 16.0586C14.3079 15.363 14.5 14.5804 14.5 13.75C14.5 10.8505 12.1495 8.5 9.25 8.5C9.21772 8.5 9.18553 8.50029 9.15341 8.50087C6.2987 8.55218 4 10.8828 4 13.75C4 15.151 4.54746 16.422 5.44215 17.3643C5.75613 17.6949 5.80666 18.1961 5.56498 18.5828L5.30425 19H8.89548Z"
										fill="currentColor"
									></path></svg
								>
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
								class="flex cursor-pointer flex-row gap-3 rounded-lg p-2 transition-colors duration-150
			ease-in-out hover:bg-slate-800 items-center"
								id={convInfo.conversationId}
							>
								<svg
									width="24"
									height="24"
									viewBox="0 0 24 24"
									fill="none"
									xmlns="http://www.w3.org/2000/svg"
									class="icon-sidebar text-token-text-secondary"
									><path
										fill-rule="evenodd"
										clip-rule="evenodd"
										d="M8.52242 6.53608C9.7871 4.41979 12.1019 3 14.75 3C18.7541 3 22 6.24594 22 10.25C22 11.9007 21.4474 13.4239 20.5183 14.6425L21.348 15.97C21.5407 16.2783 21.5509 16.6668 21.3746 16.9848C21.1984 17.3027 20.8635 17.5 20.5 17.5H15.4559C14.1865 19.5963 11.883 21 9.25 21C9.18896 21 9.12807 20.9992 9.06735 20.9977C9.04504 20.9992 9.02258 21 9 21H3.5C3.13647 21 2.80158 20.8027 2.62536 20.4848C2.44913 20.1668 2.45933 19.7783 2.652 19.47L3.48171 18.1425C2.55263 16.9239 2 15.4007 2 13.75C2 9.99151 4.85982 6.90116 8.52242 6.53608ZM10.8938 6.68714C14.106 7.43177 16.5 10.3113 16.5 13.75C16.5 14.3527 16.4262 14.939 16.2871 15.5H18.6958L18.435 15.0828C18.1933 14.6961 18.2439 14.1949 18.5579 13.8643C19.4525 12.922 20 11.651 20 10.25C20 7.3505 17.6495 5 14.75 5C13.2265 5 11.8535 5.64888 10.8938 6.68714ZM8.89548 19C8.94178 18.9953 8.98875 18.9938 9.03611 18.9957C9.107 18.9986 9.17831 19 9.25 19C11.3195 19 13.1112 17.8027 13.9668 16.0586C14.3079 15.363 14.5 14.5804 14.5 13.75C14.5 10.8505 12.1495 8.5 9.25 8.5C9.21772 8.5 9.18553 8.50029 9.15341 8.50087C6.2987 8.55218 4 10.8828 4 13.75C4 15.151 4.54746 16.422 5.44215 17.3643C5.75613 17.6949 5.80666 18.1961 5.56498 18.5828L5.30425 19H8.89548Z"
										fill="currentColor"
									></path></svg
								>
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
