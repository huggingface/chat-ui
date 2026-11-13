<script lang="ts">
	import { onDestroy } from "svelte";
	import { loadPdfJs, type PdfDocument, type PdfPage } from "$lib/utils/pdfjs";

	interface Props {
		doc: PdfDocument;
		pageNumber: number;
		/** CSS pixels per PDF point */
		scale: number;
		/** page size in points, until this page's own size is known */
		fallbackSize: { width: number; height: number };
		/** near the viewport: render it; far away: drop the bitmap */
		near: boolean;
		/** passage rectangles to flash, as fractions of the page */
		flashes?: Array<{ x: number; y: number; w: number; h: number }>;
		flashKey?: number;
		ontextlayer?: (pageNumber: number, layer: HTMLElement) => void;
	}

	let {
		doc,
		pageNumber,
		scale,
		fallbackSize,
		near,
		flashes = [],
		flashKey = 0,
		ontextlayer,
	}: Props = $props();

	let page = $state<PdfPage>();
	let size = $derived.by(() => {
		const viewport = page?.getViewport({ scale: 1 });
		return viewport ? { width: viewport.width, height: viewport.height } : fallbackSize;
	});

	let canvas = $state<HTMLCanvasElement>();
	let textLayerEl = $state<HTMLDivElement>();
	let renderedScale = $state<number | null>(null);
	let destroyed = false;
	let job = 0;

	type Task = { cancel(): void };
	let renderTask: Task | undefined;
	let textTask: Task | undefined;

	function cancel() {
		renderTask?.cancel();
		textTask?.cancel();
		renderTask = undefined;
		textTask = undefined;
	}

	async function render(targetScale: number) {
		const mine = ++job;
		cancel();
		const pdfjs = await loadPdfJs();
		const p = page ?? (await doc.getPage(pageNumber));
		if (destroyed || mine !== job) return;
		page = p;
		if (!canvas || !textLayerEl) return;

		const viewport = p.getViewport({ scale: targetScale });
		// Device pixels, capped so a zoomed-in page cannot allocate a huge bitmap.
		const dpr = Math.min(window.devicePixelRatio || 1, 2);
		const maxPixels = 16_000_000;
		const ratio = Math.min(dpr, Math.sqrt(maxPixels / (viewport.width * viewport.height)));
		const next = document.createElement("canvas");
		next.width = Math.floor(viewport.width * ratio);
		next.height = Math.floor(viewport.height * ratio);
		const task = p.render({
			canvas: next,
			viewport,
			transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined,
		});
		renderTask = task;
		try {
			await task.promise;
		} catch {
			return; // cancelled by a newer render
		}
		if (destroyed || mine !== job || !canvas) return;
		// Painted offscreen and copied in one go, so a zoom never flashes a blank page.
		canvas.width = next.width;
		canvas.height = next.height;
		canvas.getContext("2d")?.drawImage(next, 0, 0);
		next.width = 0;
		next.height = 0;

		// The text layer sizes its runs from --total-scale-factor, so it must name
		// the scale it is being laid out at before it renders.
		renderedScale = targetScale;
		const layer = textLayerEl;
		layer.replaceChildren();
		const text = new pdfjs.TextLayer({
			textContentSource: p.streamTextContent(),
			container: layer,
			viewport,
		});
		textTask = text;
		try {
			await text.render();
		} catch {
			return;
		}
		if (destroyed || mine !== job) return;
		// Lets a drag past the last line keep selecting instead of jumping, as pdf.js' viewer does.
		const end = document.createElement("div");
		end.className = "endOfContent";
		layer.append(end);
		ontextlayer?.(pageNumber, layer);
	}

	function release() {
		job++;
		cancel();
		if (canvas) {
			canvas.width = 0;
			canvas.height = 0;
		}
		textLayerEl?.replaceChildren();
		renderedScale = null;
	}

	$effect(() => {
		if (!near) {
			if (renderedScale !== null) release();
			return;
		}
		if (renderedScale === scale) return;
		// a zoom settles before the pages re-render, so dragging the zoom does not queue every step
		const timer = setTimeout(() => void render(scale), renderedScale === null ? 0 : 120);
		return () => clearTimeout(timer);
	});

	onDestroy(() => {
		destroyed = true;
		cancel();
		page?.cleanup();
	});

	function onpointerdown() {
		textLayerEl?.classList.add("selecting");
		const done = () => {
			textLayerEl?.classList.remove("selecting");
			window.removeEventListener("pointerup", done);
		};
		window.addEventListener("pointerup", done);
	}
</script>

<div
	class="pdf-page relative mx-auto bg-white shadow-sm ring-1 ring-black/5 dark:ring-white/10"
	data-page={pageNumber}
	style="width: {size.width * scale}px; height: {size.height *
		scale}px; --total-scale-factor: {renderedScale ??
		scale}; --scale-round-x: 1px; --scale-round-y: 1px;"
>
	<canvas bind:this={canvas} class="absolute inset-0 h-full w-full" aria-hidden="true"></canvas>
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		bind:this={textLayerEl}
		class="textLayer"
		style={renderedScale !== null && renderedScale !== scale
			? `transform: scale(${scale / renderedScale})`
			: ""}
		{onpointerdown}
	></div>
	{#key flashKey}
		{#each flashes as rect, i (i)}
			<div
				class="pdf-flash pointer-events-none absolute rounded-[2px]"
				style="left: {rect.x * 100}%; top: {rect.y * 100}%; width: {rect.w *
					100}%; height: {rect.h * 100}%;"
			></div>
		{/each}
	{/key}
	{#if renderedScale === null}
		<span
			class="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-gray-300"
			>{pageNumber}</span
		>
	{/if}
</div>

<style>
	.pdf-flash {
		background: rgb(250 204 21 / 0.42);
		mix-blend-mode: multiply;
		animation: pdf-flash 4.5s ease-out forwards;
	}

	@keyframes pdf-flash {
		0%,
		12% {
			background: rgb(250 204 21 / 0.75);
			box-shadow: 0 0 0 3px rgb(250 204 21 / 0.35);
		}
		70% {
			background: rgb(250 204 21 / 0.42);
			box-shadow: 0 0 0 0 transparent;
		}
		100% {
			background: rgb(250 204 21 / 0.28);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.pdf-flash {
			animation: none;
		}
	}

	/* pdf.js text layer (from pdfjs-dist/web/pdf_viewer.css), trimmed to what the
	   reader uses: transparent, absolutely placed runs over the canvas so the
	   page's text can be selected. */
	:global(.pdf-page .textLayer) {
		position: absolute;
		text-align: initial;
		inset: 0;
		overflow: clip;
		opacity: 1;
		line-height: 1;
		letter-spacing: normal;
		word-spacing: normal;
		text-size-adjust: none;
		forced-color-adjust: none;
		transform-origin: 0 0;
		caret-color: CanvasText;
		z-index: 0;
		--min-font-size: 1;
		--text-scale-factor: calc(var(--total-scale-factor) * var(--min-font-size));
		--min-font-size-inv: calc(1 / var(--min-font-size));
	}
	:global(.pdf-page .textLayer :is(span, br)) {
		color: transparent;
		position: absolute;
		white-space: pre;
		cursor: text;
		transform-origin: 0% 0%;
		user-select: text;
	}
	:global(.pdf-page .textLayer > :not(.markedContent)),
	:global(.pdf-page .textLayer .markedContent span:not(.markedContent)) {
		z-index: 1;
		--font-height: 0;
		font-size: calc(var(--text-scale-factor) * var(--font-height));
		--scale-x: 1;
		--rotate: 0deg;
		transform: rotate(var(--rotate)) scaleX(var(--scale-x)) scale(var(--min-font-size-inv));
	}
	:global(.pdf-page .textLayer .markedContent) {
		display: contents;
	}
	:global(.pdf-page .textLayer ::selection) {
		background: rgb(37 99 235 / 0.28);
		color: transparent;
	}
	:global(.pdf-page .textLayer br::selection) {
		background: transparent;
	}
	:global(.pdf-page .textLayer .endOfContent) {
		display: block;
		position: absolute;
		inset: 100% 0 0;
		z-index: 0;
		cursor: default;
		user-select: none;
	}
	:global(.pdf-page .textLayer.selecting .endOfContent) {
		top: 0;
	}
</style>
