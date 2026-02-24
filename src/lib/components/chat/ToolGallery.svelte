<script lang="ts">
	import ImageLightbox from "./ImageLightbox.svelte";
	import CarbonChevronLeft from "~icons/carbon/chevron-left";
	import CarbonChevronRight from "~icons/carbon/chevron-right";
	import CarbonMusicAdd from "~icons/carbon/music-add";

	interface GalleryItem {
		url: string;
		media_type: "image" | "video" | "audio";
		title?: string;
		description?: string;
		thumbnail_url?: string;
	}

	interface Props {
		title?: string;
		items: GalleryItem[];
	}

	let { title, items }: Props = $props();
	let lightboxSrc: string | null = $state(null);
	let scrollContainer: HTMLElement | undefined = $state();
	let canScrollLeft = $state(false);
	let canScrollRight = $state(false);

	function updateScrollState() {
		if (!scrollContainer) return;
		canScrollLeft = scrollContainer.scrollLeft > 2;
		canScrollRight =
			scrollContainer.scrollLeft + scrollContainer.clientWidth < scrollContainer.scrollWidth - 2;
	}

	$effect(() => {
		if (scrollContainer) {
			updateScrollState();
		}
	});

	function scrollBy(direction: -1 | 1) {
		scrollContainer?.scrollBy({ left: direction * 280, behavior: "smooth" });
	}
</script>

{#if items.length > 0}
	<div class="mt-1 space-y-2">
		{#if title}
			<h4 class="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
				{title}
			</h4>
		{/if}

		<div class="relative">
			{#if canScrollLeft}
				<button
					class="absolute -left-1 top-1/2 z-10 -translate-y-1/2 rounded-full border border-gray-200 bg-white/90 p-1 shadow-md backdrop-blur-sm hover:bg-white dark:border-gray-700 dark:bg-gray-800/90 dark:hover:bg-gray-800"
					onclick={() => scrollBy(-1)}
					aria-label="Scroll left"
				>
					<CarbonChevronLeft class="text-sm text-gray-600 dark:text-gray-300" />
				</button>
			{/if}

			<div
				bind:this={scrollContainer}
				onscroll={updateScrollState}
				class="scrollbar-custom flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-smooth pb-2"
			>
				{#each items as item, i (i)}
					<div class="w-56 flex-none snap-start">
						{#if item.media_type === "image"}
							<button
								class="block w-full cursor-zoom-in overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700"
								onclick={() => (lightboxSrc = item.url)}
							>
								<img
									src={item.url}
									alt={item.title ?? ""}
									class="h-40 w-full object-cover transition-transform hover:scale-105"
									loading="lazy"
								/>
							</button>
						{:else if item.media_type === "video"}
							<div class="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700">
								<!-- svelte-ignore a11y_media_has_caption -->
								<video
									src={item.url}
									controls
									preload="metadata"
									poster={item.thumbnail_url}
									class="h-40 w-full object-cover"
								></video>
							</div>
						{:else if item.media_type === "audio"}
							<div
								class="flex h-40 flex-col items-center justify-center gap-3 rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800"
							>
								<CarbonMusicAdd class="text-2xl text-gray-400 dark:text-gray-500" />
								<audio src={item.url} controls class="w-full" preload="metadata"></audio>
							</div>
						{/if}

						{#if item.title}
							<p
								class="mt-1.5 truncate text-xs font-medium text-gray-700 dark:text-gray-300"
								title={item.title}
							>
								{item.title}
							</p>
						{/if}
						{#if item.description}
							<p class="line-clamp-2 text-[11px] text-gray-500 dark:text-gray-400">
								{item.description}
							</p>
						{/if}
					</div>
				{/each}
			</div>

			{#if canScrollRight}
				<button
					class="absolute -right-1 top-1/2 z-10 -translate-y-1/2 rounded-full border border-gray-200 bg-white/90 p-1 shadow-md backdrop-blur-sm hover:bg-white dark:border-gray-700 dark:bg-gray-800/90 dark:hover:bg-gray-800"
					onclick={() => scrollBy(1)}
					aria-label="Scroll right"
				>
					<CarbonChevronRight class="text-sm text-gray-600 dark:text-gray-300" />
				</button>
			{/if}
		</div>
	</div>
{/if}

{#if lightboxSrc}
	<ImageLightbox src={lightboxSrc} onclose={() => (lightboxSrc = null)} />
{/if}
