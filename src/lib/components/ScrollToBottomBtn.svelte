<script lang="ts">
	import { fade } from 'svelte/transition';
	import IconChevron from './icons/IconChevron.svelte';
	import { onDestroy } from 'svelte';

	export let scrollNode: HTMLElement;
	export { className as class };

	let visible: boolean = false;
	let className = '';

	$: if (scrollNode) {
		scrollNode.addEventListener('scroll', onScroll);
	}

	function onScroll() {
		visible =
			Math.ceil(scrollNode.scrollTop) + 200 < scrollNode.scrollHeight - scrollNode.clientHeight;
	}

	onDestroy(() => {
		if (!scrollNode) return;
		scrollNode.removeEventListener('scroll', onScroll);
	});
</script>

{#if visible}
	<button
		transition:fade={{ duration: 150 }}
		on:click={() => scrollNode.scrollTo({ top: scrollNode.scrollHeight, behavior: 'smooth' })}
		class="absolute flex rounded-full border w-10 h-10 items-center justify-center shadow bg-white dark:bg-gray-700 dark:border-gray-600 {className}"
		><IconChevron /></button
	>
{/if}
