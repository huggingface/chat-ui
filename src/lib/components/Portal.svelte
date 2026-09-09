<script lang="ts">
	import { onMount, onDestroy } from "svelte";
	interface Props {
		children?: import("svelte").Snippet;
	}

	let { children }: Props = $props();

	let el: HTMLElement | undefined = $state();

	onMount(() => {
		el?.ownerDocument.body.appendChild(el);
	});

	onDestroy(() => {
		if (el?.parentNode) {
			el.parentNode.removeChild(el);
		}
	});
</script>

<!--
	The outer div is the node Svelte owns for this component, and it never
	moves. Tearing a block down walks the DOM from that node to the block's end
	anchor; a node that was moved into body makes the walk run along body
	instead and remove every later sibling there, other portals included. So
	only the inner div goes to body, and this component removes it itself.
-->
<div class="contents">
	<div bind:this={el} class="contents">
		{@render children?.()}
	</div>
</div>
