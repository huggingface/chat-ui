<script lang="ts">
	import { navigating } from "$app/stores";
	import { createEventDispatcher } from "svelte";
	import { browser } from "$app/environment";
	import { base } from "$app/paths";
	import { page } from "$app/stores";

	import CarbonClose from "~icons/carbon/close";
	import CarbonTextAlignJustify from "~icons/carbon/text-align-justify";
	import IconNew from "$lib/components/icons/IconNew.svelte";

	export let isOpen = false;
	export let title: string | undefined;

	$: title = title ?? "New Chat";

	let closeEl: HTMLButtonElement;
	let openEl: HTMLButtonElement;

	const dispatch = createEventDispatcher();

	$: if ($navigating) {
		dispatch("toggle", false);
	}

	$: if (isOpen && closeEl) {
		closeEl.focus();
	} else if (!isOpen && browser && document.activeElement === closeEl) {
		openEl.focus();
	}
</script>

<nav
	class="flex h-12 items-center justify-between border-b bg-gray-50 px-3 dark:border-gray-800 dark:bg-gray-800/70 md:hidden"
>
	<button
		type="button"
		class="-ml-3 flex size-12 shrink-0 items-center justify-center text-lg"
		on:click={() => dispatch("toggle", true)}
		aria-label="Open menu"
		bind:this={openEl}><CarbonTextAlignJustify /></button
	>
	{#await title}
		<div class="flex h-full items-center justify-center" />
	{:then title}
		<span class="truncate px-4">{title ?? ""}</span>
	{/await}
	<a
		class:invisible={!$page.params.id}
		href="{base}/"
		class="-mr-3 flex size-12 shrink-0 items-center justify-center text-lg"><IconNew /></a
	>
</nav>
<nav
	class="fixed inset-0 z-30 grid max-h-screen grid-cols-1 grid-rows-[auto,auto,1fr,auto] bg-white dark:bg-gray-900 {isOpen
		? 'block'
		: 'hidden'}"
>
	<div class="flex h-12 items-center px-4">
		<button
			type="button"
			class="-mr-3 ml-auto flex size-12 items-center justify-center text-lg"
			on:click={() => dispatch("toggle", false)}
			aria-label="Close menu"
			bind:this={closeEl}><CarbonClose /></button
		>
	</div>
	<slot />
</nav>
