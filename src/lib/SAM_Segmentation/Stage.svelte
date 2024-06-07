<script lang="ts">
	// @ts-nocheck
	import Tool from "./Tool.svelte";
	import Toolbar from "./Toolbar.svelte";
	import InformationPanel from "./InformationPanel.svelte";
	import { throttle } from "lodash-es"; // Ensure lodash-es is installed
	import { createEventDispatcher } from "svelte";
	import { v4 as uuid } from "uuid";

	export let image: unknown = null;
	export let maskImg: unknown = null;
	export let savedMaskImgs: unknown = [];
	export let savedClicks: unknown = [];
	export let modelScale: unknown = null;
	let current_image_id = "";
	let mask_name = "";
	let mask_description = "";
	let clickType = 1;
	function getClick(x: number, y: number) {
		return { x, y, clickType };
	}
	$: dispatch("select", current_image_id);

	const dispatch = createEventDispatcher();
	function handleMouseMove(event: MouseEvent) {
		if (!event.target) return;
		let el = event.target as HTMLElement; // Type assertion
		const rect = el.getBoundingClientRect();
		let x = event.clientX - rect.left;
		let y = event.clientY - rect.top;
		const imageScale = image ? image.width / el.offsetWidth : 1;
		x *= imageScale;
		y *= imageScale;
		const click = getClick(x, y);
		dispatch("mouseHover", { id: uuid(), click: click });
	}

	const throttledMouseMove = throttle(handleMouseMove, 15);

	const handleMouseClick = (event: MouseEvent) => {
		if (!event.target) return;
		let el = event.target as HTMLElement; // Type assertion
		const rect = el.getBoundingClientRect();
		let x = event.clientX - rect.left;
		let y = event.clientY - rect.top;
		const imageScale = image ? image.width / el.offsetWidth : 1;
		x *= imageScale;
		y *= imageScale;
		const click = getClick(x, y);
		dispatch("mouseClick", { click: click });
	};
	// Function to handle mouse out event
	const handleMouseOut = () => {
		// Replace with your logic to defer setting maskImg to null
		if (!savedMaskImgs) {
			maskImg = null;
		}
		dispatch("mouseOut");
	};

	const throttledMouseClick = throttle(handleMouseClick, 15);
</script>

<div class="relative flex h-full w-full items-stretch justify-center">
	<div class="flex h-full w-full flex-col items-center justify-center">
		<div class="relative flex h-[80%] w-[80%] items-center justify-center">
			<Tool
				handleMouseMove={throttledMouseMove}
				handleMouseClick={throttledMouseClick}
				{handleMouseOut}
				{image}
				{maskImg}
				{savedMaskImgs}
				{savedClicks}
				{modelScale}
			/>
		</div>
		{#if (savedMaskImgs && savedMaskImgs.length > 0) || (savedClicks && savedClicks.length > 0)}
			<InformationPanel
				{savedMaskImgs}
				on:update={(event) => {
					if (current_image_id !== event.detail.id) {
						current_image_id = event.detail.id;
					}
					mask_name = event.detail.name;
					mask_description = event.detail.description;
				}}
			/>
		{/if}
	</div>

	<Toolbar
		handleAdd={() => {
			clickType = 1;
		}}
		handleMinus={() => {
			clickType = 0;
		}}
		handleSave={() => {
			dispatch("save", {
				id: current_image_id,
				name: mask_name,
				description: mask_description,
			});
			console.log("saved", savedClicks);
		}}
		handleRemove={() => {
			dispatch("undo");
		}}
		handleDownload={() => {
			dispatch("download");
		}}
		handleDelete={() => {
			dispatch("delete", current_image_id);
		}}
		handleUpload={() => {
			dispatch("upload");
		}}
	/>
</div>
