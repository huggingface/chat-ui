<script lang="ts">
	import { base } from "$app/paths";
	import {
		checkPointInMask,
		tensorToMasksCanvas,
		maskingImage,
		encodedTensorToTensor,
	} from "$lib/utils/tensor";
	import { onMount } from "svelte";
	import HorizontalBarChartsExplain from "./d3figure/HorizontalBarChartsExplain.svelte";

	let imgElement: HTMLImageElement;
	export let id = "";
	export let json_data = {};
	let render_data = {};
	let maskTensor: Uint8Array | Float32Array | Int32Array = [];
	let shape: number[] = [0, 1, 1];
	let maskURLs: HTMLImageElement[] = [];
	let hoverMaskIndexes: number[] = [];
	let selectedMaskIndexes: number[] = [];
	function handleMouseMove(event: MouseEvent) {
		if (!event.target) return;
		if ((event.target as HTMLElement).tagName !== "IMG") return;
		const triggeredElement = event.target as HTMLImageElement;
		const rect = triggeredElement.getBoundingClientRect();
		const scale = triggeredElement.width / triggeredElement.naturalWidth;
		const x = Math.floor((event.clientX - rect.left) / scale); // x position within the element.
		const y = Math.floor((event.clientY - rect.top) / scale); // y position within the element.
		hoverMaskIndexes = checkPointInMask(maskTensor, shape, x, y);
	}
	function handleMouseClick(event: MouseEvent) {
		if (!event.target) return;
		if ((event.target as HTMLElement).tagName !== "IMG") return;
		const triggeredElement = event.target as HTMLImageElement;
		const rect = triggeredElement.getBoundingClientRect();
		const scale = triggeredElement.width / triggeredElement.naturalWidth;
		const x = Math.floor((event.clientX - rect.left) / scale); // x position within the element.
		const y = Math.floor((event.clientY - rect.top) / scale); // y position within the element.
		selectedMaskIndexes = checkPointInMask(maskTensor, shape, x, y);
	}
	function handleMouseOut(event: MouseEvent) {
		event.preventDefault();
		hoverMaskIndexes = [];
	}

	onMount(() => {
		console.log("json_data", json_data);
		if (json_data.image === undefined) {
			return;
		}
		console.log("json_data", json_data);
		fetch(`${base}/tensor/${json_data.mask}`)
			.then(async (res) => {
				if (!res.ok) {
					throw new Error("HTTP error, status = " + res.status);
				}
				return res.json();
			})
			.then((data) => {
				console.log("data", data);
				[maskTensor, shape] = encodedTensorToTensor(data);
				maskURLs = tensorToMasksCanvas(maskTensor, shape);
			});
	});
</script>

<div {id}>
	<div class="flex flex-col">
		<div class="flex w-full flex-row">
			<div
				class="
            border-5
            relative
            w-full
			min-w-[400px]
            overflow-hidden
            border-gray-300
            shadow-lg
    "
			>
				<img
					bind:this={imgElement}
					src={`/images/${json_data.image}`}
					on:mousemove={handleMouseMove}
					on:click={handleMouseClick}
					on:mouseleave={handleMouseOut}
					width="100%"
					alt="image"
					class="w-full"
				/>
				{#each maskURLs as maskURL}
					<img
						src={maskURL.src}
						class="border-3 pointer-events-none absolute left-0 top-0 z-10 w-full border-blue-300 opacity-30"
					/>
				{/each}
				{#each hoverMaskIndexes as index}
					<img
						src={maskURLs[index].src}
						class="border-3 pointer-events-none absolute left-0 top-0 z-10 w-full opacity-60"
					/>
				{/each}
			</div>

			<div class="relative">
				{#if selectedMaskIndexes.length > 0}
					<div class="w-full text-center">
						<h1>Selected Regions</h1>
					</div>
				{:else}
					<div class="w-full text-center">
						<h4>Hover over the image to see the regions</h4>
						{#if hoverMaskIndexes.length > 0}
							<HorizontalBarChartsExplain
								name="General Attributes: Image"
								data={Object.keys(json_data["general_attributes"][hoverMaskIndexes[0]])
									.map((key) => ({
										name: key,
										value: json_data["general_attributes"][hoverMaskIndexes[0]][key],
									}))
									.filter((attr) => !["purple", "pink"].includes(attr.name))}
							/>
						{:else if json_data.general_attributes_for_image}
							<HorizontalBarChartsExplain
								name="General Attributes: Image"
								data={Object.keys(json_data.general_attributes_for_image)
									.map((key) => ({
										name: key,
										value: json_data.general_attributes_for_image[key],
									}))
									.filter((attr) => !["purple", "pink"].includes(attr.name))}
							/>
						{/if}
					</div>
				{/if}
			</div>
		</div>
	</div>
</div>
