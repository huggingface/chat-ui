<script lang="ts">
	import "../styles/main.css";

	import { onDestroy, onMount } from "svelte";
	import { goto } from "$app/navigation";
	import { base } from "$app/paths";
	import { page } from "$app/stores";

	import { env as envPublic } from "$env/dynamic/public";

	import { error } from "$lib/stores/errors";
	import { createSettingsStore } from "$lib/stores/settings";

	import { shareConversation } from "$lib/shareConversation";

	import Toast from "$lib/components/Toast.svelte";
	import NavMenu from "$lib/components/NavMenu.svelte";
	import MobileNav from "$lib/components/MobileNav.svelte";
	import titleUpdate from "$lib/stores/titleUpdate";
	import DisclaimerModal from "$lib/components/DisclaimerModal.svelte";
	import ExpandNavigation from "$lib/components/ExpandNavigation.svelte";
	import { loginModalOpen } from "$lib/stores/loginModal";
	import LoginModal from "$lib/components/LoginModal.svelte";

	export let data;

	let isNavOpen = false;
	let isNavCollapsed = false;

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

			data.conversations = data.conversations.filter((conv) => conv.id !== id);

			if ($page.params.id === id) {
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

			data.conversations = data.conversations.map((conv) =>
				conv.id === id ? { ...conv, title } : conv
			);
		} catch (err) {
			console.error(err);
			$error = String(err);
		}
	}

	onDestroy(() => {
		clearTimeout(errorToastTimeout);
	});

	$: if ($error) onError();

	$: if ($titleUpdate) {
		const convIdx = data.conversations.findIndex(({ id }) => id === $titleUpdate?.convId);

		if (convIdx != -1) {
			data.conversations[convIdx].title = $titleUpdate?.title ?? data.conversations[convIdx].title;
		}

		$titleUpdate = null;
	}

	const settings = createSettingsStore(data.settings);

	onMount(async () => {
		if ($page.url.searchParams.has("model")) {
			await settings
				.instantSet({
					activeModel: $page.url.searchParams.get("model") ?? $settings.activeModel,
				})
				.then(async () => {
					const query = new URLSearchParams($page.url.searchParams.toString());
					query.delete("model");
					await goto(`${base}/?${query.toString()}`, {
						invalidateAll: true,
					});
				});
		}

		if ($page.url.searchParams.has("tools")) {
			const tools = $page.url.searchParams.get("tools")?.split(",");

			await settings
				.instantSet({
					tools: [...($settings.tools ?? []), ...(tools ?? [])],
				})
				.then(async () => {
					const query = new URLSearchParams($page.url.searchParams.toString());
					query.delete("tools");
					await goto(`${base}/?${query.toString()}`, {
						invalidateAll: true,
					});
				});
		}
	});

	$: mobileNavTitle = ["/models", "/assistants", "/privacy", "/tools"].includes(
		$page.route.id ?? ""
	)
		? ""
		: data.conversations.find((conv) => conv.id === $page.params.id)?.title;

	$: showDisclaimer =
		!$settings.ethicsModalAccepted &&
		$page.url.pathname !== `${base}/privacy` &&
		envPublic.PUBLIC_APP_DISCLAIMER === "1" &&
		!($page.data.shared === true);
</script>

<svelte:head>
	<title>{envPublic.PUBLIC_APP_NAME}</title>
	<meta name="description" content="The first open source alternative to ChatGPT. 💪" />
	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:site" content="@huggingface" />

	<!-- use those meta tags everywhere except on the share assistant page -->
	<!-- feel free to refacto if there's a better way -->
	{#if !$page.url.pathname.includes("/assistant/") && $page.route.id !== "/assistants" && !$page.url.pathname.includes("/models/") && !$page.url.pathname.includes("/tools")}
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

{#if showDisclaimer}
	<DisclaimerModal on:close={() => ($settings.ethicsModalAccepted = true)} />
{/if}

{#if $loginModalOpen}
	<LoginModal
		on:close={() => {
			$loginModalOpen = false;
		}}
	/>
{/if}

<ExpandNavigation
	isCollapsed={isNavCollapsed}
	on:click={() => (isNavCollapsed = !isNavCollapsed)}
	classNames="absolute inset-y-0 z-10 my-auto {!isNavCollapsed
		? 'left-[290px]'
		: 'left-0'} *:transition-transform"
/>

<div
	class="fixed grid h-full w-screen grid-cols-1 grid-rows-[auto,1fr] overflow-hidden text-smd {!isNavCollapsed
		? 'md:grid-cols-[290px,1fr]'
		: 'md:grid-cols-[0px,1fr]'} transition-[300ms] [transition-property:grid-template-columns] dark:text-gray-300 md:grid-rows-[1fr]"
>
	<MobileNav isOpen={isNavOpen} on:toggle={(ev) => (isNavOpen = ev.detail)} title={mobileNavTitle}>
		<NavMenu
			conversations={data.conversations}
			user={data.user}
			canLogin={data.user === undefined && data.loginEnabled}
			on:shareConversation={(ev) => shareConversation(ev.detail.id, ev.detail.title)}
			on:deleteConversation={(ev) => deleteConversation(ev.detail)}
			on:editConversationTitle={(ev) => editConversationTitle(ev.detail.id, ev.detail.title)}
		/>
	</MobileNav>
	<nav
		class=" grid max-h-screen grid-cols-1 grid-rows-[auto,1fr,auto] overflow-hidden *:w-[290px] max-md:hidden"
	>
		<NavMenu
			conversations={data.conversations}
			user={data.user}
			canLogin={data.user === undefined && data.loginEnabled}
			on:shareConversation={(ev) => shareConversation(ev.detail.id, ev.detail.title)}
			on:deleteConversation={(ev) => deleteConversation(ev.detail)}
			on:editConversationTitle={(ev) => editConversationTitle(ev.detail.id, ev.detail.title)}
		/>
	</nav>
	{#if currentError}
		<Toast message={currentError} />
	{/if}
	<slot />
</div>
