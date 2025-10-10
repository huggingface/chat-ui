<script lang="ts">
	import { ScrollState } from "runed";
	import { fade } from "svelte/transition";
	import IconChevron from "./icons/IconChevron.svelte";

	interface Props {
		scrollNode: HTMLElement;
		class?: string;
	}

	let { scrollNode, class: className = "" }: Props = $props();

	const scrollState = new ScrollState({ element: () => scrollNode, offset: { top: 100 } });
	const visible = $derived(!scrollState.arrived.top);

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
</script>

{#if visible}
	<button
		transition:fade={{ duration: 150 }}
		onclick={scrollToPrevious}
		class="btn absolute flex h-[41px] w-[41px] rounded-full border bg-white shadow-md transition-all hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-700 dark:shadow-gray-950 dark:hover:bg-gray-600 {className}"
	>
		<IconChevron classNames="rotate-180 mt-[2px]" />
	</button>
{/if}
