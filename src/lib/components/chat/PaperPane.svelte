<script lang="ts">
	import { tick, untrack } from "svelte";
	import { base } from "$app/paths";
	import { page as appPage } from "$app/state";
	import { sidePane, type PaneTabOf } from "$lib/stores/sidePane.svelte";
	import { pendingComposerPayload } from "$lib/stores/pendingComposerPayload";
	import { useIsDesktop } from "$lib/utils/isDesktop.svelte";
	import {
		findPassage,
		MAX_QUOTE_CHARS,
		normalizeSelectionText,
		type PaperRef,
	} from "$lib/utils/paper";
	import { loadPdfJs, type PdfDocument } from "$lib/utils/pdfjs";
	import PdfPageView from "./PdfPageView.svelte";

	import CarbonDocumentPdf from "~icons/carbon/document-pdf";
	import CarbonLaunch from "~icons/carbon/launch";
	import CarbonZoomIn from "~icons/carbon/zoom-in";
	import CarbonZoomOut from "~icons/carbon/zoom-out";
	import CarbonFitToWidth from "~icons/carbon/fit-to-width";
	import LucideMessageSquarePlus from "~icons/lucide/message-square-plus";

	/**
	 * A paper the conversation opened (see `$lib/utils/paper`), rendered with
	 * pdf.js in this document — not framed — so a selection is read straight
	 * from the page's text layer. Selected text goes to the composer as a quote
	 * chip; a citation the model wrote scrolls here and flashes its passage.
	 */
	interface Props {
		tab: PaneTabOf<"paper">;
		papers: PaperRef[];
		/** false while this tab sits in the background */
		active?: boolean;
		/** whether selections can be sent to chat (not in a shared or read-only view) */
		canQuote?: boolean;
	}

	let { tab, papers, active = true, canQuote = true }: Props = $props();

	const isDesktop = useIsDesktop();

	let paper = $derived(papers.find((p) => p.id === tab.paperId));
	let pdfUrl = $derived(
		paper && appPage.params.id
			? `${base}/conversation/${appPage.params.id}/output/${paper.sha}`
			: undefined
	);

	let doc = $state<PdfDocument>();
	let loadError = $state<string | null>(null);
	let baseSize = $state({ width: 612, height: 792 });

	$effect(() => {
		const url = pdfUrl;
		if (!url) return;
		let cancelled = false;
		let destroyTask: (() => void) | undefined;
		doc = undefined;
		loadError = null;
		(async () => {
			const pdfjs = await loadPdfJs();
			if (cancelled) return;
			const task = pdfjs.getDocument({ url });
			destroyTask = () => void task.destroy();
			const d = await task.promise;
			if (cancelled) return;
			const first = await d.getPage(1);
			const viewport = first.getViewport({ scale: 1 });
			baseSize = { width: viewport.width, height: viewport.height };
			doc = d;
		})().catch((err: unknown) => {
			if (cancelled) return;
			loadError = err instanceof Error ? err.message : String(err);
		});
		return () => {
			cancelled = true;
			destroyTask?.();
		};
	});

	// ---- layout -------------------------------------------------------------

	let scroller = $state<HTMLDivElement>();
	let body = $state<HTMLDivElement>();
	let width = $state(0);
	/** 1 is fit-to-width */
	// untracked: these seed the reader once; the tab is written back as it changes
	let zoom = $state(untrack(() => tab.reading?.zoom ?? 1));
	const PAGE_GUTTER = 32;

	$effect(() => {
		const el = scroller;
		if (!el) return;
		const observer = new ResizeObserver(() => {
			// a background tab is display:none and measures 0; keep the last layout
			if (el.clientWidth > 0) width = el.clientWidth;
		});
		observer.observe(el);
		return () => observer.disconnect();
	});

	let scale = $derived.by(() => {
		if (width <= 0) return 1;
		const fit = Math.max(width - PAGE_GUTTER, 200) / baseSize.width;
		return Math.round(Math.min(Math.max(fit * zoom, 0.3), 6) * 1000) / 1000;
	});

	const ZOOM_STEPS = [0.5, 0.67, 0.8, 1, 1.25, 1.5, 2, 2.5, 3];
	function zoomBy(direction: 1 | -1) {
		const next =
			direction > 0
				? ZOOM_STEPS.find((z) => z > zoom + 0.001)
				: [...ZOOM_STEPS].reverse().find((z) => z < zoom - 0.001);
		if (next) zoom = next;
	}

	// ---- which pages are near the viewport ----------------------------------

	let near = $state<Set<number>>(new Set([1, 2]));
	let slots: HTMLElement[] = [];

	$effect(() => {
		const root = scroller;
		const count = doc?.numPages ?? 0;
		if (!root || !count) return;
		const observer = new IntersectionObserver(
			(entries) => {
				const next = new Set(near);
				for (const entry of entries) {
					const n = Number((entry.target as HTMLElement).dataset.slot);
					if (entry.isIntersecting) next.add(n);
					else next.delete(n);
				}
				near = next;
			},
			{ root, rootMargin: "150% 0px" }
		);
		void tick().then(() => {
			for (const slot of slots.slice(0, count)) if (slot) observer.observe(slot);
		});
		return () => observer.disconnect();
	});

	// ---- current page and keeping the reading position across a re-layout -----

	let currentPage = $state(1);
	let anchor = untrack(() =>
		tab.reading
			? { page: tab.reading.page, fraction: tab.reading.fraction }
			: { page: 1, fraction: 0 }
	);

	function remember() {
		tab.reading = { page: anchor.page, fraction: anchor.fraction, zoom };
	}

	$effect(() => {
		void zoom;
		untrack(remember);
	});

	function measure() {
		const el = scroller;
		if (!el || !doc) return;
		const probe = el.scrollTop + el.clientHeight * 0.3;
		for (let n = 1; n <= doc.numPages; n++) {
			const slot = slots[n - 1];
			if (!slot) continue;
			if (slot.offsetTop + slot.offsetHeight > probe) {
				currentPage = n;
				anchor = {
					page: n,
					fraction: Math.max(0, (el.scrollTop - slot.offsetTop) / Math.max(slot.offsetHeight, 1)),
				};
				remember();
				return;
			}
		}
	}

	let scrollFrame = 0;
	function onscroll() {
		selectionUi = null;
		cancelAnimationFrame(scrollFrame);
		scrollFrame = requestAnimationFrame(measure);
	}

	// Back to the reading position after a re-layout: a zoom, a resize, and the
	// document arriving (which is when a remounted reader restores its place).
	$effect(() => {
		void scale;
		if (!doc) return;
		const { page, fraction } = anchor;
		void tick().then(() => {
			const slot = slots[page - 1];
			if (scroller && slot) scroller.scrollTop = slot.offsetTop + fraction * slot.offsetHeight;
		});
	});

	// ---- going to a passage -------------------------------------------------

	const textLayers = new Map<number, HTMLElement>();
	const layerWaiters = new Map<number, Array<(el: HTMLElement) => void>>();

	function ontextlayer(n: number, layer: HTMLElement) {
		textLayers.set(n, layer);
		for (const resolve of layerWaiters.get(n) ?? []) resolve(layer);
		layerWaiters.delete(n);
	}

	function waitForTextLayer(n: number, ms: number): Promise<HTMLElement | null> {
		const ready = textLayers.get(n);
		if (ready?.isConnected && ready.childElementCount > 0) return Promise.resolve(ready);
		return new Promise((resolve) => {
			const timer = setTimeout(() => resolve(null), ms);
			const list = layerWaiters.get(n) ?? [];
			list.push((el) => {
				clearTimeout(timer);
				resolve(el);
			});
			layerWaiters.set(n, list);
		});
	}

	function rangeAt(root: Node, start: number, end: number): Range | undefined {
		const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
		let offset = 0;
		let range: Range | undefined;
		for (let node = walker.nextNode(); node; node = walker.nextNode()) {
			const length = node.textContent?.length ?? 0;
			if (!range && start < offset + length) {
				range = document.createRange();
				range.setStart(node, start - offset);
			}
			if (range && end <= offset + length) {
				range.setEnd(node, end - offset);
				return range;
			}
			offset += length;
		}
		return undefined;
	}

	type Flash = { x: number; y: number; w: number; h: number };
	let flash = $state<{ page: number; rects: Flash[]; key: number } | null>(null);

	function passageRects(layer: HTMLElement, quote: string): Flash[] {
		const text = layer.textContent ?? "";
		const found = findPassage(text, quote);
		if (!found) return [];
		const range = rangeAt(layer, found.start, found.end);
		const pageEl = layer.parentElement;
		if (!range || !pageEl) return [];
		const box = pageEl.getBoundingClientRect();
		if (box.width === 0 || box.height === 0) return [];
		return [...range.getClientRects()]
			.filter((r) => r.width > 1 && r.height > 1)
			.map((r) => ({
				x: (r.left - box.left) / box.width,
				y: (r.top - box.top) / box.height,
				w: r.width / box.width,
				h: r.height / box.height,
			}));
	}

	let handledNonce = untrack(() => tab.seenNonce ?? 0);
	async function goTo(target: NonNullable<typeof tab.target>) {
		if (!doc || !scroller) return;
		const page = Math.min(Math.max(target.page, 1), doc.numPages);
		await tick();
		const slot = slots[page - 1];
		if (!slot) return;
		scroller.scrollTop = slot.offsetTop - 12;
		near = new Set([...near, page]);
		if (!target.quote) return;
		const layer = await waitForTextLayer(page, 6000);
		if (!layer || target.nonce !== tab.target?.nonce) return;
		const rects = passageRects(layer, target.quote);
		if (!rects.length) return;
		flash = { page, rects, key: target.nonce };
		const top = Math.min(...rects.map((r) => r.y));
		scroller.scrollTop = slot.offsetTop + top * slot.offsetHeight - scroller.clientHeight * 0.3;
	}

	$effect(() => {
		const target = tab.target;
		if (!target || !doc || !active || target.nonce === handledNonce) return;
		handledNonce = target.nonce;
		tab.seenNonce = target.nonce;
		void goTo(target);
	});

	// ---- selection → chat ---------------------------------------------------

	let selectionUi = $state<{
		x: number;
		y: number;
		quote?: { page: number; text: string };
		error?: string;
	} | null>(null);

	function pageOf(node: Node | null): number | undefined {
		const el = node instanceof Element ? node : node?.parentElement;
		const pageEl = el?.closest<HTMLElement>(".pdf-page");
		const n = Number(pageEl?.dataset.page);
		return Number.isFinite(n) && n > 0 ? n : undefined;
	}

	function readSelection() {
		selectionUi = null;
		if (!canQuote || !paper || !body) return;
		const selection = window.getSelection();
		if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;
		const range = selection.getRangeAt(0);
		if (!scroller?.contains(range.commonAncestorContainer)) return;
		const text = normalizeSelectionText(selection.toString());
		if (!text) return;

		const startPage = pageOf(range.startContainer);
		let endPage = pageOf(range.endContainer);
		// a drag that ends on the next page's first character selects nothing there
		if (endPage === (startPage ?? 0) + 1 && range.endOffset === 0) endPage = startPage;

		const rects = [...range.getClientRects()].filter((r) => r.width > 0);
		const last = rects.at(-1) ?? range.getBoundingClientRect();
		const box = body.getBoundingClientRect();
		let y = last.bottom - box.top + 8;
		if (y > box.height - 44) y = Math.max(8, (rects[0]?.top ?? last.top) - box.top - 40);
		const x = Math.min(Math.max(last.right - box.left, 80), box.width - 80);

		if (!startPage || startPage !== endPage) {
			selectionUi = { x, y, error: "Select text within one page" };
		} else if (text.length > MAX_QUOTE_CHARS) {
			selectionUi = { x, y, error: `Select at most ${MAX_QUOTE_CHARS} characters` };
		} else {
			selectionUi = { x, y, quote: { page: startPage, text } };
		}
	}

	function onpointerup() {
		requestAnimationFrame(readSelection);
	}

	function onkeyup(e: KeyboardEvent) {
		if (e.shiftKey || e.key === "Shift") requestAnimationFrame(readSelection);
	}

	$effect(() => {
		if (!active) return;
		const onchange = () => {
			const selection = window.getSelection();
			if (!selection || selection.isCollapsed) selectionUi = null;
		};
		document.addEventListener("selectionchange", onchange);
		return () => document.removeEventListener("selectionchange", onchange);
	});

	$effect(() => {
		if (!active) selectionUi = null;
	});

	function addSelectionToChat() {
		const quote = selectionUi?.quote;
		if (!quote || !paper) return;
		pendingComposerPayload.set({
			paperQuotes: [{ paperId: paper.id, page: quote.page, text: quote.text, title: paper.title }],
		});
		window.getSelection()?.removeAllRanges();
		selectionUi = null;
		// On mobile the pane overlays the chat; close it so the chip is visible.
		if (!isDesktop.current) sidePane.close();
	}

	let pageNumbers = $derived(Array.from({ length: doc?.numPages ?? 0 }, (_, i) => i + 1));
</script>

<div class="flex h-full min-h-0 flex-col">
	<header
		class="@container relative z-10 flex h-12 flex-none items-center gap-2 border-b border-gray-100 px-3 dark:border-gray-800"
	>
		<CarbonDocumentPdf class="flex-none text-gray-400 dark:text-gray-500" />
		<div class="flex min-w-0 flex-1 items-baseline gap-2">
			<h2
				class="min-w-0 truncate text-sm font-semibold text-gray-800 dark:text-gray-200"
				title={paper?.title}
			>
				{paper?.title ?? tab.label}
			</h2>
			{#if doc}
				<span
					class="flex-none font-mono text-xs text-gray-400 tabular-nums @max-[340px]:hidden dark:text-gray-500"
				>
					{currentPage}/{doc.numPages}
				</span>
			{/if}
		</div>

		<div class="flex flex-none items-center gap-0.5 text-gray-500 dark:text-gray-400">
			<button
				type="button"
				class="btn rounded-md p-1.5 text-xs hover:bg-gray-100 hover:text-gray-600 disabled:opacity-40 dark:hover:bg-gray-800 dark:hover:text-gray-300"
				title="Zoom out"
				disabled={zoom <= ZOOM_STEPS[0]}
				onclick={() => zoomBy(-1)}
			>
				<CarbonZoomOut />
			</button>
			<button
				type="button"
				class="btn min-w-10 rounded-md px-1 py-1 font-mono text-xxs tabular-nums hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
				title="Fit to width"
				onclick={() => (zoom = 1)}
			>
				{#if zoom === 1}<CarbonFitToWidth class="mx-auto text-xs" />{:else}{Math.round(
						zoom * 100
					)}%{/if}
			</button>
			<button
				type="button"
				class="btn rounded-md p-1.5 text-xs hover:bg-gray-100 hover:text-gray-600 disabled:opacity-40 dark:hover:bg-gray-800 dark:hover:text-gray-300"
				title="Zoom in"
				disabled={zoom >= ZOOM_STEPS[ZOOM_STEPS.length - 1]}
				onclick={() => zoomBy(1)}
			>
				<CarbonZoomIn />
			</button>
			{#if paper?.source}
				<a
					href={paper.source}
					target="_blank"
					rel="noopener noreferrer"
					class="btn rounded-md p-1.5 text-xs hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
					title="Open the original in a new tab"
				>
					<CarbonLaunch />
				</a>
			{/if}
		</div>
	</header>

	<div bind:this={body} class="relative min-h-0 flex-1 bg-gray-100 dark:bg-gray-950">
		{#if !paper}
			<div class="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
				<p class="text-sm font-medium text-gray-600 dark:text-gray-300">
					This paper is not open in this conversation
				</p>
				<button
					type="button"
					class="text-xs text-gray-500 underline hover:text-gray-700 dark:text-gray-400"
					onclick={() => sidePane.closeTab(tab.id)}>Close tab</button
				>
			</div>
		{:else if loadError}
			<div class="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
				<p class="text-sm font-medium text-gray-600 dark:text-gray-300">Could not load the PDF</p>
				<p class="max-w-sm text-xs text-gray-400 dark:text-gray-500">{loadError}</p>
			</div>
		{:else if !doc}
			<div
				class="flex h-full items-center justify-center text-sm text-gray-400 dark:text-gray-500"
				role="status"
			>
				Loading {paper.title}…
			</div>
		{/if}

		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			bind:this={scroller}
			class="absolute inset-0 scrollbar-custom overflow-auto {doc ? '' : 'invisible'}"
			{onscroll}
			{onpointerup}
			{onkeyup}
		>
			{#if doc}
				<div class="flex flex-col gap-3 py-4" style="min-width: {baseSize.width * scale + 16}px">
					{#each pageNumbers as n (n)}
						<div bind:this={slots[n - 1]} data-slot={n} class="px-2">
							<PdfPageView
								{doc}
								pageNumber={n}
								{scale}
								fallbackSize={baseSize}
								near={near.has(n)}
								flashes={flash?.page === n ? flash.rects : []}
								flashKey={flash?.key ?? 0}
								{ontextlayer}
							/>
						</div>
					{/each}
				</div>
			{/if}
		</div>

		{#if selectionUi}
			<div
				class="absolute z-20 -translate-x-1/2"
				style="left: {selectionUi.x}px; top: {selectionUi.y}px"
			>
				{#if selectionUi.quote}
					<button
						type="button"
						class="flex items-center gap-1.5 rounded-lg bg-gray-900 px-2.5 py-1.5 text-xs font-medium whitespace-nowrap text-white shadow-lg hover:bg-gray-700 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-200"
						onpointerdown={(e) => e.preventDefault()}
						onclick={addSelectionToChat}
					>
						<LucideMessageSquarePlus class="size-3.5" />
						Add to chat
					</button>
				{:else}
					<span
						class="rounded-lg bg-gray-900/90 px-2.5 py-1.5 text-xs whitespace-nowrap text-white shadow-lg dark:bg-white/90 dark:text-gray-900"
					>
						{selectionUi.error}
					</span>
				{/if}
			</div>
		{/if}
	</div>
</div>
