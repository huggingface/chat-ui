<script lang="ts">
	import { onDestroy, createEventDispatcher } from "svelte";

	export let hasMore: boolean = true;

	const dispatch = createEventDispatcher();

	let isLoadMore: boolean = false;
	let component: HTMLDivElement;
	let threshold: number = 10;
	$: {
		if (component) {
			const element: HTMLElement = component.parentNode as HTMLElement;
			const onScroll = (e: Event) => {
				const target = e.target as HTMLElement;

				const offset: number = target.scrollHeight - target.clientHeight - target.scrollTop;

				if (offset <= threshold) {
					if (!isLoadMore && hasMore) {
						dispatch("loadMore");
					}
					isLoadMore = true;
				} else {
					isLoadMore = false;
				}
			};

			element.addEventListener("scroll", onScroll);
			element.addEventListener("resize", onScroll);
			// Cleanup to prevent memory leaks
			onDestroy(() => {
				element.removeEventListener("scroll", onScroll);
				element.removeEventListener("resize", onScroll);
			});
		}
	}
</script>

<div bind:this={component} style="width:0px;" />
