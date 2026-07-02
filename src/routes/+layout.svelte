<script lang="ts">
	import "../styles/main.css";

	import { onDestroy, onMount } from "svelte";
	import { browser } from "$app/environment";
	import { goto } from "$app/navigation";
	import { base } from "$app/paths";
	import { page } from "$app/state";

	import { error } from "$lib/stores/errors";
	import { createSettingsStore } from "$lib/stores/settings";
	import { setHapticsEnabled } from "$lib/utils/haptics";
	import { initWithServers } from "$lib/stores/mcpServers";

	import Toast from "$lib/components/Toast.svelte";
	import NavMenu from "$lib/components/NavMenu.svelte";
	import MobileNav from "$lib/components/MobileNav.svelte";
	import WelcomeModal from "$lib/components/WelcomeModal.svelte";
	import ExpandNavigation from "$lib/components/ExpandNavigation.svelte";
	import { setContext } from "svelte";
	import { handleResponse, useAPIClient } from "$lib/APIClient";
	import { isAborted } from "$lib/stores/isAborted";
	import { isPro } from "$lib/stores/isPro";
	import BackgroundGenerationPoller from "$lib/components/BackgroundGenerationPoller.svelte";
	import { requireAuthUser } from "$lib/utils/auth";
	import { createConversationsStore } from "$lib/stores/conversations.svelte";
	import { useIsOnline } from "$lib/stores/isOnline.svelte";

	let { data = $bindable(), children } = $props();

	setContext("publicConfig", data.publicConfig);

	const publicConfig = data.publicConfig;
	const client = useAPIClient();

	const convsStore = createConversationsStore();
	convsStore.init(data.conversations);

	$effect(() => {
		convsStore.init(data.conversations);
	});

	const isOnline = useIsOnline();

	let isNavCollapsed = $state(false);

	// Measured height of the stacked top banners; used to offset the chat content.
	let bannerHeight = $state(0);

	let errorToastTimeout: ReturnType<typeof setTimeout>;
	let currentError: string | undefined = $state();

	async function onError() {
		if ($error && currentError && $error !== currentError) {
			clearTimeout(errorToastTimeout);
			currentError = undefined;
			await new Promise((resolve) => setTimeout(resolve, 300));
		}

		currentError = $error;

		errorToastTimeout = setTimeout(() => {
			$error = undefined;
			currentError = undefined;
		}, 5000);
	}

	async function deleteConversation(id: string) {
		client
			.conversations({ id })
			.delete()
			.then(handleResponse)
			.then(async () => {
				convsStore.remove(id);

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
				convsStore.update(id, { title });
			})
			.catch((err) => {
				console.error(err);
				$error = String(err);
			});
	}

	function closeWelcomeModal() {
		if (requireAuthUser()) return;
		settings.set({ welcomeModalSeen: true });
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
			if (requireAuthUser()) return;
			goto(`${base}/`, { invalidateAll: true });
		}
	};

	onDestroy(() => {
		clearTimeout(errorToastTimeout);
		if (browser) window.removeEventListener("keydown", onKeydown, { capture: true });
	});

	$effect(() => {
		if ($error) onError();
	});

	const settings = createSettingsStore(data.settings);

	$effect(() => {
		setHapticsEnabled($settings.hapticsEnabled);
	});

	// Service worker update handling
	let swUpdateAvailable = $state(false);

	onMount(async () => {
		initWithServers(data.mcpBaseServers ?? []);

		if (publicConfig.isHuggingChat && data.user?.username) {
			fetch(`https://huggingface.co/api/users/${data.user.username}/overview`)
				.then((res) => res.json())
				.then((userData) => {
					isPro.set(userData.isPro ?? false);
				})
				.catch(() => {
					// keep isPro as null on error
				});
		}

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

		// Register service worker and listen for updates
		if ("serviceWorker" in navigator) {
			const registration = await navigator.serviceWorker.getRegistration();

			if (registration) {
				// A new SW is waiting to activate
				if (registration.waiting) {
					swUpdateAvailable = true;
				}

				// Listen for new SW installations
				registration.addEventListener("updatefound", () => {
					const newWorker = registration.installing;
					if (newWorker) {
						newWorker.addEventListener("statechange", () => {
							if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
								swUpdateAvailable = true;
							}
						});
					}
				});
			}

			// When the SW takes control, reload to activate the new version
			navigator.serviceWorker.addEventListener("controllerchange", () => {
				window.location.reload();
			});
		}

		window.addEventListener("keydown", onKeydown, { capture: true });
	});

	function handleUpdateNow() {
		swUpdateAvailable = false;
		if ("serviceWorker" in navigator) {
			navigator.serviceWorker.getRegistration().then((registration) => {
				if (registration?.waiting) {
					registration.waiting.postMessage({ type: "SKIP_WAITING" });
				}
			});
		}
	}

	let mobileNavTitle = $derived(
		["/models", "/privacy"].includes(page.route.id ?? "")
			? ""
			: convsStore.list.find((conv) => conv.id === page.params.id)?.title
	);

	// Show the welcome modal once on first app load
	let showWelcome = $derived(
		!$settings.welcomeModalSeen &&
			!(page.data.shared === true && page.route.id?.startsWith("/conversation/"))
	);

	// Shared conversation views define their own social preview tags
	// (see SharePreviewTags.svelte), so skip the generic ones there
	let isSharedConversationView = $derived(
		page.route.id === "/r/[id]" ||
			(page.route.id === "/conversation/[id]" && page.params.id?.length === 7)
	);
</script>

<svelte:head>
	<title>{publicConfig.PUBLIC_APP_NAME} - Chat with AI models</title>
	<meta name="description" content={publicConfig.PUBLIC_APP_DESCRIPTION} />
	<meta name="twitter:site" content="@huggingface" />

	<!-- use those meta tags everywhere except on special listing pages -->
	<!-- feel free to refacto if there's a better way -->
	{#if !page.url.pathname.includes("/models/") && !isSharedConversationView}
		<meta name="twitter:card" content="summary_large_image" />
		<meta name="twitter:title" content="{publicConfig.PUBLIC_APP_NAME} - Chat with AI models" />
		<meta name="twitter:description" content={publicConfig.PUBLIC_APP_DESCRIPTION} />
		<meta
			name="twitter:image"
			content="{publicConfig.PUBLIC_ORIGIN ||
				page.url.origin}{publicConfig.assetPath}/thumbnail.png"
		/>
		<meta name="twitter:image:alt" content="{publicConfig.PUBLIC_APP_NAME} preview" />
		<meta property="og:title" content="{publicConfig.PUBLIC_APP_NAME} - Chat with AI models" />
		<meta property="og:type" content="website" />
		<meta property="og:url" content="{publicConfig.PUBLIC_ORIGIN || page.url.origin}{base}" />
		<meta property="og:image" content="{publicConfig.assetPath}/thumbnail.png" />
		<meta property="og:description" content={publicConfig.PUBLIC_APP_DESCRIPTION} />
		<meta property="og:site_name" content={publicConfig.PUBLIC_APP_NAME} />
		<meta property="og:locale" content="en_US" />
	{/if}
	<link rel="icon" href="{publicConfig.assetPath}/icon.svg" type="image/svg+xml" />
	{#if publicConfig.PUBLIC_ORIGIN}
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
	{:else}
		<link rel="icon" href="{publicConfig.assetPath}/favicon-dev.svg" type="image/svg+xml" />
	{/if}
	<link rel="apple-touch-icon" href="{publicConfig.assetPath}/apple-touch-icon.png" />
	<link rel="manifest" href="{publicConfig.assetPath}/manifest.json" />

	{#if publicConfig.PUBLIC_PLAUSIBLE_SCRIPT_URL}
		<script async src={publicConfig.PUBLIC_PLAUSIBLE_SCRIPT_URL}></script>
	{/if}

	{#if publicConfig.PUBLIC_APPLE_APP_ID}
		<meta name="apple-itunes-app" content={`app-id=${publicConfig.PUBLIC_APPLE_APP_ID}`} />
	{/if}
</svelte:head>

{#if showWelcome}
	<WelcomeModal close={closeWelcomeModal} />
{/if}

<BackgroundGenerationPoller />

<!-- Top banners pinned to the very top across all viewports. bannerHeight is
	measured so the app shell below can be offset by exactly the stacked banner
	height, keeping both the navbar and the page content clear of the banners. -->
<div
	bind:clientHeight={bannerHeight}
	class="fixed top-0 right-0 left-0 z-50 flex flex-col"
>
	{#if browser && !isOnline.value}
		<div
			class="flex items-center justify-center gap-2 bg-amber-500 px-4 py-2 text-sm font-medium text-white shadow-md"
		>
			<span class="inline-block size-2 rounded-full bg-white/60"></span>
			You are currently offline. Some features may be unavailable.
		</div>
	{/if}

	{#if swUpdateAvailable}
		<div
			class="flex items-center justify-center gap-3 bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-md"
		>
			<span>A new version of {publicConfig.PUBLIC_APP_NAME} is available.</span>
			<button
				class="rounded-lg bg-white px-3 py-1 text-sm font-semibold text-blue-700 hover:bg-blue-50"
				onclick={handleUpdateNow}
			>
				Update Now
			</button>
		</div>
	{/if}
</div>

<div
	class="fixed grid h-dvh w-screen grid-cols-1 grid-rows-[auto_1fr] overflow-hidden text-smd {!isNavCollapsed
		? 'md:grid-cols-[260px_1fr]'
		: 'md:grid-cols-[0px_1fr]'} transition-[300ms] [transition-property:grid-template-columns] md:grid-rows-[1fr] dark:text-gray-300"
	style:padding-top={bannerHeight ? `${bannerHeight}px` : undefined}
>
	<ExpandNavigation
		isCollapsed={isNavCollapsed}
		onClick={() => (isNavCollapsed = !isNavCollapsed)}
		classNames="absolute inset-y-0 z-10 my-auto {!isNavCollapsed
			? 'left-[260px]'
			: 'left-0'} *:transition-transform"
	/>

	<MobileNav title={mobileNavTitle}>
		<NavMenu
			conversations={convsStore.list}
			user={data.user}
			ondeleteConversation={(id) => deleteConversation(id)}
			oneditConversationTitle={(payload) => editConversationTitle(payload.id, payload.title)}
		/>
	</MobileNav>
	<nav
		class="grid max-h-dvh grid-cols-1 grid-rows-[auto_1fr_auto] overflow-hidden *:w-[260px] max-md:hidden"
	>
		<NavMenu
			conversations={convsStore.list}
			user={data.user}
			ondeleteConversation={(id) => deleteConversation(id)}
			oneditConversationTitle={(payload) => editConversationTitle(payload.id, payload.title)}
		/>
	</nav>
	{#if currentError}
		<Toast message={currentError} />
	{/if}
	{@render children?.()}

	{#if publicConfig.PUBLIC_PLAUSIBLE_SCRIPT_URL}
		<script>
			((window.plausible =
				window.plausible ||
				function () {
					(plausible.q = plausible.q || []).push(arguments);
				}),
				(plausible.init =
					plausible.init ||
					function (i) {
						plausible.o = i || {};
					}));
			plausible.init();
		</script>
	{/if}
</div>
