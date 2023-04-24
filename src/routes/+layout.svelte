<script lang="ts">
	import { goto, invalidate } from "$app/navigation";
	import { page } from "$app/stores";
	import "../styles/main.css";
	import type { LayoutData } from "./$types";

	import CarbonTrashCan from "~icons/carbon/trash-can";
	import CarbonExport from "~icons/carbon/export";
	import { base } from "$app/paths";
	import { shareConversation } from "$lib/shareConversation";
	import { UrlDependency } from "$lib/types/UrlDependency";

	export let data: LayoutData;

	function switchTheme() {
		const { classList } = document.querySelector("html") as HTMLElement;
		if (classList.contains("dark")) {
			classList.remove("dark");
			localStorage.theme = "light";
		} else {
			classList.add("dark");
			localStorage.theme = "dark";
		}
	}

	async function deleteConversation(id: string) {
		try {
			const res = await fetch(`${base}/conversation/${id}`, {
				method: "DELETE",
				headers: {
					"Content-Type": "application/json",
				},
			});

			if (!res.ok) {
				alert("Error while deleting conversation: " + (await res.text()));
				return;
			}

			if ($page.params.id !== id) {
				await invalidate(UrlDependency.ConversationList);
			} else {
				await goto(base || "/", { invalidateAll: true });
			}
		} catch (err) {
			console.error(err);
			alert("Error while deleting conversation: " + err);
		}
	}
</script>

<div
	class="grid h-screen w-screen md:grid-cols-[280px,1fr] overflow-hidden text-smd dark:text-gray-300"
>
	<nav
		class="max-md:hidden grid grid-rows-[auto,1fr,auto] grid-cols-1 max-h-screen bg-gradient-to-l from-gray-50 dark:from-gray-800/30 rounded-r-xl"
	>
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
					class="pl-3 pr-2 h-11 group rounded-lg flex-none text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-1.5 {conv.id ===
					$page.params.id
						? 'bg-gray-100 dark:bg-gray-700'
						: ''}"
				>
					<div class="flex-1 truncate">{conv.title}</div>

					<button
						type="button"
						class="w-5 h-5 items-center justify-center hidden group-hover:flex rounded"
						title="Share conversation"
						on:click|preventDefault={() => shareConversation(conv.id, conv.title)}
					>
						<CarbonExport
							class="text-gray-400 hover:text-gray-500  dark:hover:text-gray-300 text-xs"
						/>
					</button>

					<button
						type="button"
						class="w-5 h-5 items-center justify-center hidden group-hover:flex rounded"
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
	</nav>
	<slot />
</div>
