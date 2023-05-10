<script lang="ts">
	import { onMount, onDestroy } from "svelte";

	let el: HTMLElement;

	onMount(() => {
		el.ownerDocument.body.appendChild(el);
	});

	onDestroy(() => {
		if (el?.parentNode) {
			el.parentNode.removeChild(el);
		}
	});
</script>

<div bind:this={el} class="contents" hidden>
	<slot />
</div>
