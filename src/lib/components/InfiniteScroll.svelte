<script lang="ts">
	import { onMount, createEventDispatcher } from "svelte";

	const dispatch = createEventDispatcher();
	let loader: HTMLDivElement | undefined = $state();
	let observer: IntersectionObserver;
	let intervalId: ReturnType<typeof setInterval> | undefined;

	onMount(() => {
		if (!loader) {
			return;
		}

		observer = new IntersectionObserver((entries) => {
			entries.forEach((entry) => {
				if (entry.isIntersecting) {
					// Clear any existing interval
					if (intervalId) {
						clearInterval(intervalId);
					}
					// Start new interval that dispatches every 250ms
					intervalId = setInterval(() => {
						dispatch("visible");
					}, 250);
				} else {
					// Clear interval when not intersecting
					if (intervalId) {
						clearInterval(intervalId);
						intervalId = undefined;
					}
				}
			});
		});

		observer.observe(loader);

		return () => {
			observer.disconnect();
			if (intervalId) {
				clearInterval(intervalId);
			}
		};
	});
</script>

<div bind:this={loader} class="flex animate-pulse flex-col gap-4">
	<div class="w-5/5 ml-2 h-5 gap-5 rounded bg-gray-300 dark:bg-gray-700"></div>
	<div class="w-5/5 ml-2 h-5 gap-5 rounded bg-gray-300 dark:bg-gray-700"></div>
	<div class="w-5/5 ml-2 h-5 gap-5 rounded bg-gray-300 dark:bg-gray-700"></div>
</div>
