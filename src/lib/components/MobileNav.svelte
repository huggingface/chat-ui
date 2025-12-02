<script lang="ts" module>
	let isOpen = $state(false);

	export function closeMobileNav() {
		isOpen = false;
	}
</script>

<script lang="ts">
	import { browser } from "$app/environment";
	import { beforeNavigate } from "$app/navigation";
	import { base } from "$app/paths";
	import { page } from "$app/state";
	import IconNew from "$lib/components/icons/IconNew.svelte";
	import IconShare from "$lib/components/icons/IconShare.svelte";
	import IconBurger from "$lib/components/icons/IconBurger.svelte";
	import { Spring } from "svelte/motion";
	import { shareModal } from "$lib/stores/shareModal";
	import { loading } from "$lib/stores/loading";
	import { requireAuthUser } from "$lib/utils/auth";
	interface Props {
		title: string | undefined;
		children?: import("svelte").Snippet;
	}

	let { title = $bindable(), children }: Props = $props();

	let closeEl: HTMLButtonElement | undefined = $state();
	let openEl: HTMLButtonElement | undefined = $state();

	const isHuggingChat = $derived(Boolean(page.data?.publicConfig?.isHuggingChat));
	const canShare = $derived(
		isHuggingChat &&
			!$loading &&
			Boolean(page.params?.id) &&
			page.route.id?.startsWith("/conversation/")
	);

	// Define the width for the drawer (less than 100% to create the gap)
	const drawerWidthPercentage = 85;

	const tween = Spring.of(
		() => {
			if (isOpen) {
				return 0 as number;
			}
			return -100 as number;
		},
		{ stiffness: 0.2, damping: 0.8 }
	);

	$effect(() => {
		title ??= "New Chat";
	});

	beforeNavigate(() => {
		isOpen = false;
	});

	let shouldFocusClose = $derived(isOpen && closeEl);
	let shouldRefocusOpen = $derived(!isOpen && browser && document.activeElement === closeEl);

	$effect(() => {
		if (shouldFocusClose) {
			closeEl?.focus();
		} else if (shouldRefocusOpen) {
			openEl?.focus();
		}
	});

	// Function to close the drawer when background is tapped
	function closeDrawer() {
		isOpen = false;
	}
</script>

<nav
	class="flex h-12 items-center justify-between rounded-b-xl border-b bg-gray-50 px-3 dark:border-gray-800 dark:bg-gray-800/30 dark:shadow-xl md:hidden"
>
	<button
		type="button"
		class="-ml-3 flex size-12 shrink-0 items-center justify-center text-lg"
		onclick={() => (isOpen = true)}
		aria-label="Open menu"
		bind:this={openEl}><IconBurger /></button
	>
	<div class="flex h-full items-center justify-center overflow-hidden">
		{#if page.params?.id}
			<span class="max-w-full truncate px-4 first-letter:uppercase" data-testid="chat-title"
				>{title}</span
			>
		{/if}
	</div>
	<div class="flex items-center">
		{#if isHuggingChat}
			<button
				type="button"
				class="flex size-8 shrink-0 items-center justify-center text-lg"
				disabled={!canShare}
				onclick={() => {
					if (!canShare) return;
					shareModal.open();
				}}
				aria-label="Share conversation"
			>
				<IconShare classNames={!canShare ? "opacity-40" : ""} />
			</button>
		{/if}
		<a
			href="{base}/"
			class="flex size-8 shrink-0 items-center justify-center text-lg"
			onclick={(e) => {
				if (requireAuthUser()) {
					e.preventDefault();
				}
			}}
		>
			<IconNew />
		</a>
	</div>
</nav>

<!-- Mobile drawer overlay - shows when drawer is open -->
{#if isOpen}
	<button
		type="button"
		class="fixed inset-0 z-20 cursor-default bg-black/30 md:hidden"
		style="opacity: {Math.max(0, Math.min(1, (100 + tween.current) / 100))};"
		onclick={closeDrawer}
		aria-label="Close mobile navigation"
	></button>
{/if}

<nav
	style="transform: translateX({Math.max(
		-100,
		Math.min(0, tween.current)
	)}%); width: {drawerWidthPercentage}%;"
	class:shadow-[5px_0_15px_0_rgba(0,0,0,0.3)]={isOpen}
	class="fixed bottom-0 left-0 top-0 z-30 grid max-h-dvh grid-cols-1
	grid-rows-[auto,1fr,auto,auto] rounded-r-xl bg-white pt-4 dark:bg-gray-900 md:hidden"
>
	{@render children?.()}
</nav>
