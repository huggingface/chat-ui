<script lang="ts">
	import { navigating } from "$app/stores";
	import { createEventDispatcher } from "svelte";
	import { browser } from "$app/environment";
	import { base } from "$app/paths";

	import CarbonClose from "~icons/carbon/close";
	import CarbonAdd from "~icons/carbon/add";
	import CarbonTextAlignJustify from "~icons/carbon/text-align-justify";

	export let isOpen = false;
	export let title: string;

	$: title = title || "New Chat";

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

<nav class="md:hidden flex items-center h-12 border-b px-4 justify-between dark:border-gray-800">
	<button
		type="button"
		class="flex items-center justify-center w-9 h-9 -ml-3 shrink-0"
		on:click={() => dispatch("toggle", true)}
		aria-label="Open menu"
		bind:this={openEl}><CarbonTextAlignJustify /></button
	>
	<span class="px-4 truncate">{title}</span>
	<a href={base || "/"} class="flex items-center justify-center w-9 h-9 -mr-3 shrink-0"
		><CarbonAdd /></a
	>
</nav>
<nav
	class="fixed inset-0 z-50 grid grid-rows-[auto,auto,1fr,auto] grid-cols-1 max-h-screen bg-white dark:bg-gray-900 bg-gradient-to-l from-gray-50 dark:from-gray-800/30 {isOpen
		? 'block'
		: 'hidden'}"
>
	<div class="flex items-center px-4 h-12">
		<button
			type="button"
			class="flex items-center justify-center ml-auto w-9 h-9 -mr-3"
			on:click={() => dispatch("toggle", false)}
			aria-label="Close menu"
			bind:this={closeEl}><CarbonClose /></button
		>
	</div>
	<slot />
</nav>
