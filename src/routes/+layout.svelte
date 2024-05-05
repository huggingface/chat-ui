<script lang="ts">
	import "../styles/main.css";

	import { onDestroy } from "svelte";
	import { goto, invalidate } from "$app/navigation";
	import { base } from "$app/paths";
	import { page } from "$app/stores";
	import { browser } from "$app/environment";

	import { env as envPublic } from "$env/dynamic/public";

	import { error } from "$lib/stores/errors";
	import { createSettingsStore } from "$lib/stores/settings";

	import { shareConversation } from "$lib/shareConversation";
	import { UrlDependency } from "$lib/types/UrlDependency";
	import type { ConvSidebar } from "$lib/types/ConvSidebar";

	import Toast from "$lib/components/Toast.svelte";
	import NavMenu from "$lib/components/NavMenu.svelte";
	import MobileNav from "$lib/components/MobileNav.svelte";
	import convUpdate from "$lib/stores/convUpdate";
	import titleUpdate from "$lib/stores/titleUpdate";
	import DisclaimerModal from "$lib/components/DisclaimerModal.svelte";
	import ExpandNavigation from "$lib/components/ExpandNavigation.svelte";

	export let data;

	let isNavOpen = false;
	let isNavCollapsed = false;
	let hasMore = true;
	let extraConversation: [] = [];
	let total = 300;
	let extra = 50;

	let errorToastTimeout: ReturnType<typeof setTimeout>;
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

			fetchData();
			if ($page.params.id !== id) {
				await invalidate(UrlDependency.ConversationList);
			} else {
				await goto(`${base}/`, { invalidateAll: true });
			}
		} catch (err) {
			console.error(err);
			$error = String(err);
		}
	}

	async function editConversationTitle(id: string, title: string) {
		try {
			const res = await fetch(`${base}/conversation/${id}`, {
				method: "PATCH",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ title }),
			});

			if (!res.ok) {
				$error = "Error while editing title, try again.";
				return;
			}

			fetchData();
			await invalidate(UrlDependency.ConversationList);
		} catch (err) {
			console.error(err);
			$error = String(err);
		}
	}

	onDestroy(() => {
		clearTimeout(errorToastTimeout);
	});

	//for getting extra conversation and maintaning consistency
	async function fetchData(call: string = "") {
		if (call === "" && extraConversation.length === 0) return;
		try {
			const url =
				call === "extra"
					? `${base}/conversations/?limit=${extra}&skip=${total + extraConversation.length}`
					: `${base}/conversations/?limit=${extraConversation.length}&skip=${total}`;
			const res = await fetch(url, {
				method: "GET",
				headers: {
					"Content-Type": "application/json",
				},
			});

			if (!res.ok) {
				$error = "Error while fetching onversations, try again.";
				return;
			}

			const conversations: [] = (await res.json()).conversations;
			conversations.forEach((conv: ConvSidebar) => (conv.updatedAt = new Date(conv.updatedAt)));

			if (call == "extra") extraConversation = [...extraConversation, ...conversations];
			else extraConversation = [...conversations];

			if (conversations.length == 0) hasMore = false;
			else hasMore = true;
		} catch (err) {
			console.error(err);
			$error = String(err);
		}
	}

	$: data.conversations = [...data.conversations.slice(0, total), ...extraConversation];

	$: if (extraConversation.findIndex(({ id }) => id === $convUpdate) != -1) {
		fetchData();
		$convUpdate = null;
	}

	$: if ($error) onError();

	$: if ($titleUpdate) {
		const convIdx = data.conversations.findIndex(({ id }) => id === $titleUpdate?.convId);

		if (convIdx != -1) {
			data.conversations[convIdx].title = $titleUpdate?.title ?? data.conversations[convIdx].title;
		}
		fetchData();
		// update data.conversations
		data.conversations = [...data.conversations];

		$titleUpdate = null;
	}

	const settings = createSettingsStore(data.settings);

	$: if (browser && $page.url.searchParams.has("model")) {
		if ($settings.activeModel === $page.url.searchParams.get("model")) {
			goto(`${base}/?`);
		}
		settings.instantSet({
			activeModel: $page.url.searchParams.get("model") ?? $settings.activeModel,
		});
	}

	$: mobileNavTitle = ["/models", "/assistants", "/privacy"].includes($page.route.id ?? "")
		? ""
		: data.conversations.find((conv) => conv.id === $page.params.id)?.title;
</script>

<svelte:head>
	<title>{envPublic.PUBLIC_APP_NAME}</title>
	<meta name="description" content="The first open source alternative to ChatGPT. 💪" />
	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:site" content="@huggingface" />

	<!-- use those meta tags everywhere except on the share assistant page -->
	<!-- feel free to refacto if there's a better way -->
	{#if !$page.url.pathname.includes("/assistant/") && $page.route.id !== "/assistants" && !$page.url.pathname.includes("/models/")}
		<meta property="og:title" content={envPublic.PUBLIC_APP_NAME} />
		<meta property="og:type" content="website" />
		<meta property="og:url" content="{envPublic.PUBLIC_ORIGIN || $page.url.origin}{base}" />
		<meta
			property="og:image"
			content="{envPublic.PUBLIC_ORIGIN ||
				$page.url.origin}{base}/{envPublic.PUBLIC_APP_ASSETS}/thumbnail.png"
		/>
		<meta property="og:description" content={envPublic.PUBLIC_APP_DESCRIPTION} />
	{/if}
	<link
		rel="icon"
		href="{envPublic.PUBLIC_ORIGIN ||
			$page.url.origin}{base}/{envPublic.PUBLIC_APP_ASSETS}/favicon.ico"
		sizes="32x32"
	/>
	<link
		rel="icon"
		href="{envPublic.PUBLIC_ORIGIN ||
			$page.url.origin}{base}/{envPublic.PUBLIC_APP_ASSETS}/icon.svg"
		type="image/svg+xml"
	/>
	<link
		rel="apple-touch-icon"
		href="{envPublic.PUBLIC_ORIGIN ||
			$page.url.origin}{base}/{envPublic.PUBLIC_APP_ASSETS}/apple-touch-icon.png"
	/>
	<link
		rel="manifest"
		href="{envPublic.PUBLIC_ORIGIN ||
			$page.url.origin}{base}/{envPublic.PUBLIC_APP_ASSETS}/manifest.json"
	/>

	{#if envPublic.PUBLIC_PLAUSIBLE_SCRIPT_URL && envPublic.PUBLIC_ORIGIN}
		<script
			defer
			data-domain={new URL(envPublic.PUBLIC_ORIGIN).hostname}
			src={envPublic.PUBLIC_PLAUSIBLE_SCRIPT_URL}
		></script>
	{/if}

	{#if envPublic.PUBLIC_APPLE_APP_ID}
		<meta name="apple-itunes-app" content={`app-id=${envPublic.PUBLIC_APPLE_APP_ID}`} />
	{/if}
</svelte:head>

{#if !$settings.ethicsModalAccepted && $page.url.pathname !== `${base}/privacy`}
	<DisclaimerModal />
{/if}

<ExpandNavigation
	isCollapsed={isNavCollapsed}
	on:click={() => (isNavCollapsed = !isNavCollapsed)}
	classNames="absolute inset-y-0 z-10 my-auto {!isNavCollapsed
		? 'left-[280px]'
		: 'left-0'} *:transition-transform"
/>

<div
	class="grid h-full w-screen grid-cols-1 grid-rows-[auto,1fr] overflow-hidden text-smd {!isNavCollapsed
		? 'md:grid-cols-[280px,1fr]'
		: 'md:grid-cols-[0px,1fr]'} transition-[300ms] [transition-property:grid-template-columns] md:grid-rows-[1fr] dark:text-gray-300"
>
	<MobileNav isOpen={isNavOpen} on:toggle={(ev) => (isNavOpen = ev.detail)} title={mobileNavTitle}>
		<NavMenu
			conversations={data.conversations}
			user={data.user}
			canLogin={data.user === undefined && data.loginEnabled}
			{hasMore}
			on:shareConversation={(ev) => shareConversation(ev.detail.id, ev.detail.title)}
			on:deleteConversation={(ev) => deleteConversation(ev.detail)}
			on:editConversationTitle={(ev) => editConversationTitle(ev.detail.id, ev.detail.title)}
			on:loadMore={() => {
				fetchData("extra");
			}}
		/>
	</MobileNav>
	<nav
		class=" grid max-h-screen grid-cols-1 grid-rows-[auto,1fr,auto] overflow-hidden *:w-[280px] max-md:hidden"
	>
		<NavMenu
			conversations={data.conversations}
			user={data.user}
			canLogin={data.user === undefined && data.loginEnabled}
			{hasMore}
			on:shareConversation={(ev) => shareConversation(ev.detail.id, ev.detail.title)}
			on:deleteConversation={(ev) => deleteConversation(ev.detail)}
			on:editConversationTitle={(ev) => editConversationTitle(ev.detail.id, ev.detail.title)}
			on:loadMore={() => {
				fetchData("extra");
			}}
		/>
	</nav>
	{#if currentError}
		<Toast message={currentError} />
	{/if}
	<slot />
</div>
