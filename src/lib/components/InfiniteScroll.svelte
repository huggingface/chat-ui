<script lang="ts">
	import { onMount } from "svelte";
	import { createEventDispatcher } from "svelte";

	const dispatch = createEventDispatcher();
	let loader: HTMLDivElement;
	let observer: IntersectionObserver;

	onMount(() => {
		observer = new IntersectionObserver((entries) => {
			entries.forEach((entry) => {
				if (entry.isIntersecting) {
					dispatch("visible");
				}
			});
		});

		observer.observe(loader);

		return () => {
			observer.disconnect();
		};
	});
</script>

<div bind:this={loader} class="flex animate-pulse flex-col gap-4">
	<div class="ml-2 h-5 w-4/5 gap-5 rounded bg-gray-200 dark:bg-gray-700" />
	<div class="ml-2 h-5 w-4/5 gap-5 rounded bg-gray-200 dark:bg-gray-700" />
	<div class="ml-2 h-5 w-4/5 gap-5 rounded bg-gray-200 dark:bg-gray-700" />
</div>
