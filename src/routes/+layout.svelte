<script lang="ts">
	import { onDestroy } from "svelte";
	import { goto, invalidate } from "$app/navigation";
	import { page } from "$app/stores";
	import "../styles/main.css";
	import { base } from "$app/paths";
	import { PUBLIC_ORIGIN } from "$env/static/public";

	import { shareConversation } from "$lib/shareConversation";
	import { UrlDependency } from "$lib/types/UrlDependency";
	import { error } from "$lib/stores/errors";

	import MobileNav from "$lib/components/MobileNav.svelte";
	import NavMenu from "$lib/components/NavMenu.svelte";
	import Logo from "$lib/components/icons/Logo.svelte";
	import Modal from "$lib/components/Modal.svelte";
	import Toast from "$lib/components/Toast.svelte";

	export let data;

	let isNavOpen = false;
	let ethicsModal = true;
	let errorToastTimeout: NodeJS.Timeout;
	let currentError: string | null;

	async function onError() {
		// If a new different error comes, wait for the current error to hide first
		if ($error && currentError && $error !== currentError) {
			clearTimeout(errorToastTimeout);
			currentError = null;
			await new Promise((resolve) => setTimeout(resolve, 300));
		}

		currentError = $error;

		errorToastTimeout = setTimeout(() => {
			$error = null;
			currentError = null;
		}, 3000);
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
				$error = "Error while deleting conversation, try again.";
				return;
			}

			if ($page.params.id !== id) {
				await invalidate(UrlDependency.ConversationList);
			} else {
				await goto(base || "/", { invalidateAll: true });
			}
		} catch (err) {
			console.error(err);
			$error = String(err);
		}
	}

	onDestroy(() => {
		clearTimeout(errorToastTimeout);
	});

	$: if ($error) onError();
</script>

<svelte:head>
	<meta name="description" content="The first open source alternative to ChatGPT. 💪" />
	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:site" content="@huggingface" />
	<meta property="og:title" content="HuggingChat" />
	<meta property="og:type" content="website" />
	<meta property="og:url" content="{PUBLIC_ORIGIN || $page.url.origin}{base}" />
	<meta property="og:image" content="{PUBLIC_ORIGIN || $page.url.origin}{base}/thumbnail.png" />
</svelte:head>

<div
	class="grid h-full w-screen grid-cols-1 grid-rows-[auto,1fr] overflow-hidden text-smd dark:text-gray-300 md:grid-cols-[280px,1fr] md:grid-rows-[1fr]"
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
	<nav class="grid max-h-screen grid-cols-1 grid-rows-[auto,1fr,auto] max-md:hidden">
		<NavMenu
			conversations={data.conversations}
			on:shareConversation={(ev) => shareConversation(ev.detail.id, ev.detail.title)}
			on:deleteConversation={(ev) => deleteConversation(ev.detail)}
		/>
	</nav>
	{#if currentError}
		<Toast message={currentError} />
	{/if}
	{#if ethicsModal}
		<Modal>
			<div
				class="flex w-full flex-col items-center gap-6 bg-gradient-to-t from-yellow-500/40 via-yellow-500/10 to-yellow-500/0 px-4 pb-10 pt-9 text-center"
			>
				<h2 class="flex items-center text-2xl font-semibold">
					<Logo classNames="text-3xl mr-1.5" />HuggingChat
					<div
						class="ml-3 flex h-6 items-center rounded-lg border border-gray-100 bg-gray-50 px-2 text-base text-gray-400 dark:border-gray-700/60 dark:bg-gray-800"
					>
						v0
					</div>
				</h2>
				<p class="px-4 text-lg font-semibold leading-snug text-gray-800 sm:px-12">
					This application is for demonstration purposes only.
				</p>
				<p class="text-gray-800">
					AI is an area of active research with known problems such as biased generation and
					misinformation. Do not use this application for high-stakes decisions or advice.
				</p>
				<a
					href="/chat"
					class="mt-2 rounded-full bg-black px-5 py-2 text-lg font-semibold text-gray-100 transition-colors hover:bg-yellow-500"
					>Start chatting</a
				>
			</div>
		</Modal>
	{/if}
	<slot />
</div>
