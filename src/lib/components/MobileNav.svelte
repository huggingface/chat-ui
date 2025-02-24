<script lang="ts">
	import { browser } from "$app/environment";
	import { beforeNavigate } from "$app/navigation";
	import { base } from "$app/paths";
	import { page } from "$app/state";
	import IconNew from "$lib/components/icons/IconNew.svelte";
	import { createEventDispatcher } from "svelte";
	import { fly } from "svelte/transition";
	import CarbonClose from "~icons/carbon/close";
	import CarbonTextAlignJustify from "~icons/carbon/text-align-justify";
	import { swipe, type SwipeCustomEvent } from "svelte-gestures";
	interface Props {
		isOpen?: boolean;
		title: string | undefined;
		children?: import("svelte").Snippet;
	}

	let { isOpen = false, title = $bindable(), children }: Props = $props();

	let closeEl: HTMLButtonElement | undefined = $state();
	let openEl: HTMLButtonElement | undefined = $state();

	$effect(() => {
		title ??= "New Chat";
	});

	const dispatch = createEventDispatcher();
	beforeNavigate(() => {
		dispatch("toggle", false);
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
</script>

<nav
	class="flex h-12 items-center justify-between border-b bg-gray-50 px-3 dark:border-gray-800 dark:bg-gray-800/70 md:hidden"
>
	<button
		type="button"
		class="-ml-3 flex size-12 shrink-0 items-center justify-center text-lg"
		onclick={() => dispatch("toggle", true)}
		aria-label="Open menu"
		bind:this={openEl}><CarbonTextAlignJustify /></button
	>
	<div class="flex h-full items-center justify-center">
		<span class="truncate px-4" data-testid="chat-title">{title}</span>
	</div>
	<a
		class:invisible={!page.params?.id}
		href="{base}/"
		class="-mr-3 flex size-12 shrink-0 items-center justify-center text-lg"><IconNew /></a
	>
</nav>

{#if isOpen}
	<nav
		use:swipe={() => ({ timeframe: 300, minSwipeDistance: 60 })}
		onswipe={(ev: SwipeCustomEvent) => {
			if (ev.detail.direction === "left") {
				dispatch("toggle", false);
			}
		}}
		class="fixed inset-0 z-30 grid max-h-screen grid-cols-1 grid-rows-[auto,1fr,auto,auto] bg-white pt-4 dark:bg-gray-900"
		in:fly={{ x: -window.innerWidth, duration: 250 }}
		out:fly={{ x: -window.innerWidth, duration: 250 }}
	>
		{#if page.url.pathname === base + "/"}
			<button
				type="button"
				class="absolute right-0 top-0 z-10 flex size-12 items-center justify-center text-lg"
				onclick={() => dispatch("toggle", false)}
				aria-label="Close menu"
				bind:this={closeEl}><CarbonClose /></button
			>
		{/if}
		{@render children?.()}
	</nav>
{/if}
