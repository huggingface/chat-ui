<script lang="ts">
	import { goto, invalidateAll } from "$app/navigation";
	import { page } from "$app/stores";
	import "../styles/main.css";
	import type { LayoutData } from "./$types";
	import { base } from "$app/paths";

	import MobileNav from "$lib/components/MobileNav.svelte";
	import NavMenu from "$lib/components/NavMenu.svelte";

	export let data: LayoutData;

	let isNavOpen = false;

	async function shareConversation(id: string, title: string) {
		try {
			const res = await fetch(`${base}/conversation/${id}/share`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
			});

			if (!res.ok) {
				alert("Error while sharing conversation: " + (await res.text()));
				return;
			}

			const { url } = await res.json();

			if (navigator.share) {
				navigator.share({
					title,
					text: "Share this chat with others",
					url,
				});
			} else {
				prompt("Share this link with your friends:", url);
			}
		} catch (err) {
			console.error(err);
			alert("Error while sharing conversation: " + err);
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
				await invalidateAll();
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
	class="grid h-screen w-screen grid-rows-[auto,1fr] md:grid-rows-[1fr] md:grid-cols-[280px,1fr] overflow-hidden text-smd dark:text-gray-300"
>
	<MobileNav
		isOpen={isNavOpen}
		on:toggle={(ev) => (isNavOpen = ev.detail)}
		title={data.conversations.find((conv) => conv.id === $page.params.id)?.title}
	>
		<NavMenu
			conversations={data.conversations}
			on:shareConversation={(ev) => shareConversation(ev.detail.id, ev.detail.title)}
			on:deleteConversation={(ev) => deleteConversation(ev.detail)}
		/>
	</MobileNav>
	<nav
		class="max-md:hidden grid grid-rows-[auto,1fr,auto] grid-cols-1 max-h-screen bg-gradient-to-l from-gray-50 dark:from-gray-800/30 rounded-r-xl"
	>
		<NavMenu
			conversations={data.conversations}
			on:shareConversation={(ev) => shareConversation(ev.detail.id, ev.detail.title)}
			on:deleteConversation={(ev) => deleteConversation(ev.detail)}
		/>
	</nav>
	<slot />
</div>
