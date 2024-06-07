<script>
	import { onMount } from "svelte";
	import CarbonAdd from "~icons/carbon/add-alt";
	import CarbonSubtract from "~icons/carbon/subtract-alt";
	export let handleMouseMove = null;
	export let handleMouseClick = null;
	export let handleMouseOut = null;
	export let image = null;
	export let maskImg = null;
	export let savedClicks = [];
	export let savedMaskImgs = [];
	export let modelScale = null;
	let ratio = 1;
	$: ratio = shouldFitToWidth ? window.innerWidth / image.width : window.innerHeight / image.height;
	let shouldFitToWidth = true;
	let imageClasses = "";
	let maskImageClasses =
		"absolute top-0 left-0 z-10 opacity-40 border-3 border-red-500 pointer-events-none";

	const fitToPage = () => {
		if (!image) return;
		const imageAspectRatio = image.width / image.height;
		const screenAspectRatio = window.innerWidth / window.innerHeight;
		shouldFitToWidth = imageAspectRatio > screenAspectRatio;
	};

	// Setup ResizeObserver
	onMount(() => {
		const bodyEl = document.body;
		const resizeObserver = new ResizeObserver((entries) => {
			for (const entry of entries) {
				if (entry.target === bodyEl) {
					fitToPage();
				}
			}
		});

		fitToPage();
		resizeObserver.observe(bodyEl);
		const element = document.getElementById("img-div");
		if (element) {
			const styles = getComputedStyle(element);
		}
		return () => {
			resizeObserver.unobserve(bodyEl);
		};
	});
</script>

<div id="img-div" class="relative min-h-0 min-w-0">
	{#if image}
		<div
			on:mousemove={handleMouseMove}
			on:touchstart={handleMouseMove}
			on:mouseleave={handleMouseOut}
			on:mousedown={handleMouseClick}
			class={(shouldFitToWidth ? "w-full" : "h-full") + " " + imageClasses}
		>
			<img src={image.src} class="h-full w-full" />
		</div>
	{/if}
	{#if maskImg}
		<div class={(shouldFitToWidth ? "w-full" : "h-full") + " " + maskImageClasses}>
			<img src={maskImg.src} alt="" />
		</div>
	{/if}
	{#if savedMaskImgs}
		{#each savedMaskImgs as savedMaskImg}
			<div class={(shouldFitToWidth ? "w-full" : "h-full") + " " + maskImageClasses}>
				<img src={savedMaskImg.src} alt="" />
			</div>
		{/each}
	{/if}
	<div class={" border-3 absolute left-0 top-0 z-10 bg-red-500 bg-red-800"}>
		{#if savedClicks}
			{#each savedClicks as savedClick}
				{#if savedClick.click.clickType === 1}
					<div
						class={"border-3 absolute z-10 h-4 w-4 items-center justify-center rounded-full bg-blue-500 text-white"}
						style="left: {(savedClick.click.x - 14) * 0.8}px; top: {(savedClick.click.y - 10) *
							0.8}px;"
					>
						<CarbonAdd class />
					</div>
				{:else}
					<div
						class={"border-3 absolute z-10 h-5 w-5 items-center justify-center rounded-full bg-red-500 text-white"}
						style="left: {(savedClick.click.x - 14) * 0.8}px; top: {(savedClick.click.y - 10) *
							0.8}px;"
					>
						<CarbonSubtract />
					</div>
				{/if}
			{/each}
		{/if}
	</div>
</div>
