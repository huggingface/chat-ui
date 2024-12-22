<script lang="ts">
	import { fade } from "svelte/transition";
	import { onDestroy } from "svelte";
	import IconChevron from "./icons/IconChevron.svelte";

	export let scrollNode: HTMLElement;
	export { className as class };

	let visible = false;
	let className = "";
	let observer: ResizeObserver | null = null;

	$: if (scrollNode) {
		destroy();

		if (window.ResizeObserver) {
			observer = new ResizeObserver(() => {
				updateVisibility();
			});
			observer.observe(scrollNode);
		}
		scrollNode.addEventListener("scroll", updateVisibility);
	}

	function updateVisibility() {
		if (!scrollNode) return;
		visible =
			Math.ceil(scrollNode.scrollTop) + 200 < scrollNode.scrollHeight - scrollNode.clientHeight &&
			scrollNode.scrollTop > 200;
	}

	function scrollToPrevious() {
		if (!scrollNode) return;
		const messages = scrollNode.querySelectorAll("[data-message-id]");
		const scrollTop = scrollNode.scrollTop;
		let previousMessage: Element | null = null;

		for (let i = messages.length - 1; i >= 0; i--) {
			const messageTop =
				messages[i].getBoundingClientRect().top +
				scrollTop -
				scrollNode.getBoundingClientRect().top;
			if (messageTop < scrollTop - 1) {
				previousMessage = messages[i];
				break;
			}
		}

		if (previousMessage) {
			previousMessage.scrollIntoView({ behavior: "smooth", block: "start" });
		}
	}

	function destroy() {
		observer?.disconnect();
		scrollNode?.removeEventListener("scroll", updateVisibility);
	}

	onDestroy(destroy);
</script>

{#if visible}
	<button
		transition:fade={{ duration: 150 }}
		on:click={scrollToPrevious}
		class="btn absolute flex h-[41px] w-[41px] rounded-full border bg-white shadow-md transition-all hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-700 dark:shadow-gray-950 dark:hover:bg-gray-600 {className}"
	>
		<IconChevron classNames="rotate-180 mt-[2px]" />
	</button>
{/if}
