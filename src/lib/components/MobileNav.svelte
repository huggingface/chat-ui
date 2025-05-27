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
	import { Spring } from "svelte/motion";
	import CarbonClose from "~icons/carbon/close";
	import CarbonTextAlignJustify from "~icons/carbon/text-align-justify";
	import { pan, type GestureCustomEvent, type PanCustomEvent } from "svelte-gestures";
	interface Props {
		title: string | undefined;
		children?: import("svelte").Snippet;
	}

	let { title = $bindable(), children }: Props = $props();

	let closeEl: HTMLButtonElement | undefined = $state();
	let openEl: HTMLButtonElement | undefined = $state();

	let panX: number | undefined = $state(undefined);
	let panStart: number | undefined = $state(undefined);
	let panStartTime: number | undefined = undefined;

	// Define the width for the drawer (less than 100% to create the gap)
	const drawerWidthPercentage = 85;

	const tween = Spring.of(
		() => {
			if (panX !== undefined) {
				return panX;
			}
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
		panX = undefined;
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
		panX = undefined;
	}
</script>

<nav
	class="flex h-12 items-center justify-between border-b bg-gray-50 px-3 dark:border-gray-800 dark:bg-gray-800/70 md:hidden"
>
	<button
		type="button"
		class="-ml-3 flex size-12 shrink-0 items-center justify-center text-lg"
		onclick={() => (isOpen = true)}
		aria-label="Open menu"
		bind:this={openEl}><CarbonTextAlignJustify /></button
	>
	<div class="flex h-full items-center justify-center overflow-hidden">
		{#if page.params?.id}
			<span class="max-w-full truncate px-4" data-testid="chat-title">{title}</span>
		{/if}
	</div>
	<a
		class:invisible={!page.params?.id}
		href="{base}/"
		class="-mr-3 flex size-12 shrink-0 items-center justify-center text-lg"><IconNew /></a
	>
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
	use:pan={() => ({ delay: 0, preventdefault: true, touchAction: "pan-left" })}
	onpanup={(e: GestureCustomEvent) => {
		if (!panStart || !panStartTime || !panX) {
			return;
		}
		// measure the pan velocity to determine if the menu should snap open or closed
		const drawerWidth = window.innerWidth * (drawerWidthPercentage / 100);

		const trueX = e.detail.x + (panX / 100) * drawerWidth;

		const panDuration = Date.now() - panStartTime;
		const panVelocity = (trueX - panStart) / panDuration;

		panX = undefined;
		panStart = undefined;
		panStartTime = undefined;

		if (panVelocity < -0.5 || trueX < 50) {
			isOpen = !isOpen;
		}
	}}
	onpan={(e: PanCustomEvent) => {
		if (e.detail.pointerType !== "touch") {
			panX = undefined;
			panStart = undefined;
			panStartTime = undefined;
			return;
		}

		panX ??= 0;
		panStart ??= e.detail.x;
		panStartTime ??= Date.now();

		const drawerWidth = window.innerWidth * (drawerWidthPercentage / 100);

		const trueX = e.detail.x + (panX / 100) * drawerWidth;
		const percentage = ((trueX - panStart) / drawerWidth) * 100;

		panX = Math.max(-100, Math.min(0, percentage));
		tween.set(panX, { instant: true });
	}}
	style="transform: translateX({Math.max(
		-100,
		Math.min(0, tween.current)
	)}%); width: {drawerWidthPercentage}%;"
	class:shadow-[5px_0_15px_0_rgba(0,0,0,0.3)]={isOpen}
	class="fixed bottom-0 left-0 top-0 z-30 grid max-h-screen
	grid-cols-1 grid-rows-[auto,1fr,auto,auto] bg-white pt-4 dark:bg-gray-900 md:hidden"
>
	{#if page.url.pathname === base + "/"}
		<button
			type="button"
			class="absolute right-0 top-0 z-50 flex size-12 items-center justify-center text-lg"
			onclick={() => (isOpen = false)}
			aria-label="Close menu"
			bind:this={closeEl}><CarbonClose /></button
		>
	{/if}
	{@render children?.()}
</nav>
