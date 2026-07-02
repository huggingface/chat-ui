<script lang="ts">
	import { onMount } from "svelte";
	interface Props {
		onvisible?: () => void | Promise<void>;
	}

	let { onvisible }: Props = $props();

	let loader: HTMLDivElement | undefined = $state();
	let observer: IntersectionObserver;

	onMount(() => {
		if (!loader) {
			return;
		}

		let busy = false;

		observer = new IntersectionObserver(async (entries) => {
			if (busy || !entries.some((entry) => entry.isIntersecting)) {
				return;
			}
			busy = true;
			try {
				await onvisible?.();
			} finally {
				busy = false;
				// Re-observe so the observer delivers a fresh entry against the
				// updated layout: if the sentinel is still visible after the new
				// content rendered, this triggers the next load; otherwise it
				// re-arms for the next scroll into view.
				if (loader) {
					observer.unobserve(loader);
					observer.observe(loader);
				}
			}
		});

		observer.observe(loader);

		return () => {
			observer.disconnect();
		};
	});
</script>

<div bind:this={loader} class="h-2"></div>
