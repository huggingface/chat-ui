<script lang="ts">
	import { fade } from "svelte/transition";

	import IconDazzled from "$lib/components/icons/IconDazzled.svelte";

	export let message = "";
</script>

<div
	transition:fade={{ duration: 300 }}
	class="fixed right-0 top-12 md:top-0 bg-gradient-to-bl from-red-500/20 via-red-500/0 to-red-500/0 pt-2 md:pt-5 pr-2 md:pr-8 pl-36 pb-36 z-20 pointer-events-none"
>
	<div
		class="flex items-center bg-white/90 dark:bg-gray-900/80 rounded-full py-1 px-3 shadow-sm pointer-events-auto"
	>
		<IconDazzled classNames="text-2xl mr-2" />
		<h2 class="font-semibold">{message}</h2>
	</div>
</div>
