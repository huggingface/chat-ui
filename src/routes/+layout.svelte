<script lang="ts">
	import "../styles/main.css";

	import { onDestroy, onMount, untrack } from "svelte";
	import { goto } from "$app/navigation";
	import { base } from "$app/paths";
	import { page } from "$app/state";

	import { error } from "$lib/stores/errors";
	import { createSettingsStore } from "$lib/stores/settings";

	import Toast from "$lib/components/Toast.svelte";
	import NavMenu from "$lib/components/NavMenu.svelte";
	import MobileNav from "$lib/components/MobileNav.svelte";
	import titleUpdate from "$lib/stores/titleUpdate";
	import WelcomeModal from "$lib/components/WelcomeModal.svelte";
	import ExpandNavigation from "$lib/components/ExpandNavigation.svelte";
	import { loginModalOpen } from "$lib/stores/loginModal";
	import LoginModal from "$lib/components/LoginModal.svelte";
	import OverloadedModal from "$lib/components/OverloadedModal.svelte";
	import { setContext } from "svelte";
	import { handleResponse, useAPIClient } from "$lib/APIClient";
	import { isAborted } from "$lib/stores/isAborted";
	import IconShare from "$lib/components/icons/IconShare.svelte";
	import { shareModal } from "$lib/stores/shareModal";
	import BackgroundGenerationPoller from "$lib/components/BackgroundGenerationPoller.svelte";

	let { data = $bindable(), children } = $props();

	setContext("publicConfig", data.publicConfig);

	const publicConfig = data.publicConfig;
	const client = useAPIClient();

	let conversations = $state(data.conversations);
	$effect(() => {
		data.conversations && untrack(() => (conversations = data.conversations));
	});

	let isNavCollapsed = $state(false);

	let overloadedModalOpen = $state(false);

	let errorToastTimeout: ReturnType<typeof setTimeout>;
	let currentError: string | undefined = $state();

	async function onError() {
		// If a new different error comes, wait for the current error to hide first
		if ($error && currentError && $error !== currentError) {
			clearTimeout(errorToastTimeout);
			currentError = undefined;
			await new Promise((resolve) => setTimeout(resolve, 300));
		}

		currentError = $error;

		if (currentError === "Model is overloaded") {
			overloadedModalOpen = true;
		}
		errorToastTimeout = setTimeout(() => {
			$error = undefined;
			currentError = undefined;
		}, 5000);
	}

	const canShare = $derived(
		publicConfig.isHuggingChat &&
			Boolean(page.params?.id) &&
			page.route.id?.startsWith("/conversation/")
	);

	async function deleteConversation(id: string) {
		client
			.conversations({ id })
			.delete()
			.then(handleResponse)
			.then(async () => {
				conversations = conversations.filter((conv) => conv.id !== id);

				if (page.params.id === id) {
					await goto(`${base}/`, { invalidateAll: true });
				}
			})
			.catch((err) => {
				console.error(err);
				$error = String(err);
			});
	}

	async function editConversationTitle(id: string, title: string) {
		client
			.conversations({ id })
			.patch({ title })
			.then(handleResponse)
			.then(async () => {
				conversations = conversations.map((conv) => (conv.id === id ? { ...conv, title } : conv));
			})
			.catch((err) => {
				console.error(err);
				$error = String(err);
			});
	}

	onDestroy(() => {
		clearTimeout(errorToastTimeout);
	});

	$effect(() => {
		if ($error) onError();
	});

	$effect(() => {
		if ($titleUpdate) {
			const convIdx = conversations.findIndex(({ id }) => id === $titleUpdate?.convId);

			if (convIdx != -1) {
				conversations[convIdx].title = $titleUpdate?.title ?? conversations[convIdx].title;
			}

			$titleUpdate = null;
		}
	});

	const settings = createSettingsStore(data.settings);

	onMount(async () => {
		if (page.url.searchParams.has("model")) {
			await settings
				.instantSet({
					activeModel: page.url.searchParams.get("model") ?? $settings.activeModel,
				})
				.then(async () => {
					const query = new URLSearchParams(page.url.searchParams.toString());
					query.delete("model");
					await goto(`${base}/?${query.toString()}`, {
						invalidateAll: true,
					});
				});
		}

		if (page.url.searchParams.has("token")) {
			const token = page.url.searchParams.get("token");

			await fetch(`${base}/api/user/validate-token`, {
				method: "POST",
				body: JSON.stringify({ token }),
			}).then(() => {
				goto(`${base}/`, { invalidateAll: true });
			});
		}

		// Global keyboard shortcut: New Chat (Ctrl/Cmd + Shift + O)
		const onKeydown = (e: KeyboardEvent) => {
			// Ignore when a modal has focus (app is inert)
			const appEl = document.getElementById("app");
			if (appEl?.hasAttribute("inert")) return;

			const oPressed = e.key?.toLowerCase() === "o";
			const metaOrCtrl = e.metaKey || e.ctrlKey;
			if (oPressed && e.shiftKey && metaOrCtrl) {
				e.preventDefault();
				isAborted.set(true);
				goto(`${base}/`, { invalidateAll: true });
			}
		};

		window.addEventListener("keydown", onKeydown, { capture: true });
		onDestroy(() => window.removeEventListener("keydown", onKeydown, { capture: true }));
	});

	let mobileNavTitle = $derived(
		["/models", "/privacy"].includes(page.route.id ?? "")
			? ""
			: conversations.find((conv) => conv.id === page.params.id)?.title
	);

	// Show the welcome modal once on first app load
	let showWelcome = $derived(!$settings.welcomeModalSeen && !(page.data.shared === true));
</script>

<svelte:head>
	<title>{publicConfig.PUBLIC_APP_NAME}</title>
	<meta name="description" content={publicConfig.PUBLIC_APP_DESCRIPTION} />
	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:site" content="@huggingface" />

	<!-- use those meta tags everywhere except on special listing pages -->
	<!-- feel free to refacto if there's a better way -->
	{#if !page.url.pathname.includes("/models/")}
		<meta property="og:title" content={publicConfig.PUBLIC_APP_NAME} />
		<meta property="og:type" content="website" />
		<meta property="og:url" content="{publicConfig.PUBLIC_ORIGIN || page.url.origin}{base}" />
		<meta property="og:image" content="{publicConfig.assetPath}/thumbnail.png" />
		<meta property="og:description" content={publicConfig.PUBLIC_APP_DESCRIPTION} />
	{/if}
	<link
		rel="icon"
		href="{publicConfig.assetPath}/favicon.svg"
		type="image/svg+xml"
		media="(prefers-color-scheme: light)"
	/>
	<link
		rel="icon"
		href="{publicConfig.assetPath}/favicon-dark.svg"
		type="image/svg+xml"
		media="(prefers-color-scheme: dark)"
	/>
	<link rel="icon" href="{publicConfig.assetPath}/icon.svg" type="image/svg+xml" />
	<link rel="apple-touch-icon" href="{publicConfig.assetPath}/apple-touch-icon.png" />
	<link rel="manifest" href="{publicConfig.assetPath}/manifest.json" />

	{#if publicConfig.PUBLIC_PLAUSIBLE_SCRIPT_URL && publicConfig.PUBLIC_ORIGIN}
		<script
			defer
			data-domain={new URL(publicConfig.PUBLIC_ORIGIN).hostname}
			src={publicConfig.PUBLIC_PLAUSIBLE_SCRIPT_URL}
		></script>
	{/if}

	{#if publicConfig.PUBLIC_APPLE_APP_ID}
		<meta name="apple-itunes-app" content={`app-id=${publicConfig.PUBLIC_APPLE_APP_ID}`} />
	{/if}
</svelte:head>

{#if showWelcome}
	<WelcomeModal close={() => settings.set({ welcomeModalSeen: true })} />
{/if}

{#if $loginModalOpen}
	<LoginModal
		onclose={() => {
			$loginModalOpen = false;
		}}
	/>
{/if}

{#if overloadedModalOpen && publicConfig.isHuggingChat}
	<OverloadedModal onClose={() => (overloadedModalOpen = false)} />
{/if}

<BackgroundGenerationPoller />

<div
	class="fixed grid h-full w-screen grid-cols-1 grid-rows-[auto,1fr] overflow-hidden text-smd {!isNavCollapsed
		? 'md:grid-cols-[290px,1fr]'
		: 'md:grid-cols-[0px,1fr]'} transition-[300ms] [transition-property:grid-template-columns] dark:text-gray-300 md:grid-rows-[1fr]"
>
	<ExpandNavigation
		isCollapsed={isNavCollapsed}
		onClick={() => (isNavCollapsed = !isNavCollapsed)}
		classNames="absolute inset-y-0 z-10 my-auto {!isNavCollapsed
			? 'left-[290px]'
			: 'left-0'} *:transition-transform"
	/>

	{#if canShare}
		<button
			type="button"
			class="hidden size-8 items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white/90 text-sm font-medium text-gray-700 shadow-sm hover:bg-white/60 hover:text-gray-500 dark:border-gray-700 dark:bg-gray-800/80 dark:text-gray-200 dark:hover:bg-gray-700 md:absolute md:right-6 md:top-5 md:flex"
			onclick={() => shareModal.open()}
			aria-label="Share conversation"
		>
			<IconShare />
		</button>
	{/if}

	<MobileNav title={mobileNavTitle}>
		<NavMenu
			{conversations}
			user={data.user}
			canLogin={!data.user && data.loginEnabled}
			ondeleteConversation={(id) => deleteConversation(id)}
			oneditConversationTitle={(payload) => editConversationTitle(payload.id, payload.title)}
		/>
	</MobileNav>
	<nav
		class="grid max-h-screen grid-cols-1 grid-rows-[auto,1fr,auto] overflow-hidden *:w-[290px] max-md:hidden"
	>
		<NavMenu
			{conversations}
			user={data.user}
			canLogin={!data.user && data.loginEnabled}
			ondeleteConversation={(id) => deleteConversation(id)}
			oneditConversationTitle={(payload) => editConversationTitle(payload.id, payload.title)}
		/>
	</nav>
	{#if currentError}
		<Toast message={currentError} />
	{/if}
	{@render children?.()}
</div>
