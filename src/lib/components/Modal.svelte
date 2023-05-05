<script lang="ts">
	import { cubicOut } from "svelte/easing";
	import { fade } from "svelte/transition";

	export let width = "max-w-sm";
</script>

<div
	transition:fade={{ easing: cubicOut, duration: 300 }}
	class="fixed inset-0 z-40 flex items-center justify-center bg-black/80 p-8 backdrop-blur-sm dark:bg-black/50"
>
	<div class="-mt-10 overflow-hidden rounded-2xl bg-white shadow-2xl md:-mt-20 {width}">
		<slot />
	</div>
</div>
