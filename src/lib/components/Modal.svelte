<script lang="ts">
	import { cubicOut } from "svelte/easing";
	import { fade } from "svelte/transition";
</script>

<div
	transition:fade={{ easing: cubicOut, duration: 300 }}
	class="fixed inset-0 z-40 flex items-center justify-center bg-black/80 p-8 backdrop-blur-sm dark:bg-black/50"
>
	<div class="-mt-10 max-w-sm overflow-hidden rounded-2xl bg-white shadow-2xl md:-mt-20">
		<slot />
	</div>
</div>
