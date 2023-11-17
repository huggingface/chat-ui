<script lang="ts">
	import { onMount, onDestroy } from "svelte";

	export let initialX: number = 50;
	export let initialY: number = 50;
	export let initialWidth: number = 150;
	export let initialHeight: number = 100;
	export let label: string = "cat";
	export let onMove: (
		position: { x: number; y: number },
		annotationMoveLabel: string
	) => void = () => {};
	export let onResize: (
		size: { width: number; height: number },
		annotationResizeLabel: string
	) => void = () => {};

	let x: number = initialX;
	let y: number = initialY;
	let width: number = initialWidth;
	let height: number = initialHeight;
	let dragging: boolean = false;
	let resizing: boolean = false;
	let startX: number, startY: number, startWidth: number, startHeight: number;

	const dragStart = (event: MouseEvent): void => {
		dragging = true;
		startX = event.clientX - x;
		startY = event.clientY - y;
	};

	const resizeStart = (event: MouseEvent): void => {
		resizing = true;
		startWidth = width;
		startHeight = height;
		startX = event.clientX;
		startY = event.clientY;
		event.stopPropagation();
	};

	const mouseMove = (event: MouseEvent): void => {
		let moved: boolean = false,
			resized: boolean = false;

		if (dragging) {
			x = event.clientX - startX;
			y = event.clientY - startY;
			moved = true;
		}
		if (resizing) {
			width = Math.max(20, startWidth + event.clientX - startX);
			height = Math.max(20, startHeight + event.clientY - startY);
			resized = true;
		}

		if (moved) {
			onMove({ x, y }, label);
		}
		if (resized) {
			onResize({ width, height }, label);
		}
	};

	const mouseUp = (): void => {
		dragging = false;
		resizing = false;
	};

	onMount(() => {
		window.addEventListener("mousemove", mouseMove);
		window.addEventListener("mouseup", mouseUp);
	});

	onDestroy(() => {
		window.removeEventListener("mousemove", mouseMove);
		window.removeEventListener("mouseup", mouseUp);
	});
</script>

<div
	class="bounding-box"
	style="left: {x}px; top: {y}px; width: {width}px; height: {height}px;"
	on:mousedown={dragStart}
	role="slider"
	aria-valuenow={x}
	tabindex="0"
>
	<div
		class="resize-handle"
		on:mousedown={resizeStart}
		role="slider"
		aria-valuenow={x}
		tabindex="0"
	/>
</div>
<div class="bounding-box-label" style="left: {x}px; top: {y}px;">
	{label}
</div>

<style>
	.bounding-box {
		position: absolute;
		border: 2px solid #4682b4;
		background-color: rgba(0, 0, 0, 0.1);
	}

	.resize-handle {
		position: absolute;
		right: 0;
		bottom: 0;
		width: 10px;
		height: 10px;
		background-color: #4682b4;
		cursor: se-resize;
	}
	.bounding-box-label {
		position: absolute;
		background-color: #4682b4;
		color: white;
		padding: 0.5rem;
		border-radius: 0.5rem;
	}
</style>
