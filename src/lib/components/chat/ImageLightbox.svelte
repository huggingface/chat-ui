<script lang="ts">
	import { onMount } from "svelte";
	import Portal from "../Portal.svelte";
	import CarbonClose from "~icons/carbon/close";
	import { tap as hapticTap } from "$lib/utils/haptics";

	interface Props {
		src: string;
		onclose: () => void;
	}

	let { src, onclose }: Props = $props();

	const MIN_SCALE = 1;
	const MAX_SCALE = 5;
	const TAP_SLOP = 6;
	const DOUBLE_TAP_MS = 300;
	const DOUBLE_TAP_DIST = 30;
	const DOUBLE_TAP_TARGET_SCALE = 2.5;
	const RUBBER_BAND = 0.35;
	const RUBBER_BAND_SCALE = 0.5;

	let scale = $state(1);
	let tx = $state(0);
	let ty = $state(0);
	let isGesturing = $state(false);

	let overlayEl: HTMLDivElement | undefined = $state();
	let imgEl: HTMLImageElement | undefined = $state();

	type Point = { x: number; y: number };
	const pointers = new Map<number, Point>();

	let pinchStartDist = 0;
	let pinchStartScale = 1;
	let pinchStartCenter: Point = { x: 0, y: 0 };
	let pinchStartTx = 0;
	let pinchStartTy = 0;
	let panStartTx = 0;
	let panStartTy = 0;
	let panStartPointer: Point = { x: 0, y: 0 };
	let pointerDownPos: Point = { x: 0, y: 0 };
	let pointerDownTarget: EventTarget | null = null;
	let movedDuringGesture = false;
	let multiTouchOccurred = false;
	let lastTapTime = 0;
	let lastTapPos: Point = { x: 0, y: 0 };
	let baseSize = { w: 0, h: 0 };

	const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
	const midpoint = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
	const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

	function viewportCenter(): Point {
		if (!overlayEl) return { x: 0, y: 0 };
		const rect = overlayEl.getBoundingClientRect();
		return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
	}

	function viewportSize() {
		if (!overlayEl) return { w: window.innerWidth, h: window.innerHeight };
		const rect = overlayEl.getBoundingClientRect();
		return { w: rect.width, h: rect.height };
	}

	function captureBaseSize() {
		if (!imgEl || scale === 0) return;
		const rect = imgEl.getBoundingClientRect();
		baseSize = { w: rect.width / scale, h: rect.height / scale };
	}

	function getBounds() {
		const vp = viewportSize();
		const dispW = baseSize.w * scale;
		const dispH = baseSize.h * scale;
		return {
			maxTx: Math.max(0, (dispW - vp.w) / 2),
			maxTy: Math.max(0, (dispH - vp.h) / 2),
		};
	}

	function applyPanRubberBand() {
		const { maxTx, maxTy } = getBounds();
		if (tx > maxTx) tx = maxTx + (tx - maxTx) * RUBBER_BAND;
		else if (tx < -maxTx) tx = -maxTx + (tx + maxTx) * RUBBER_BAND;
		if (ty > maxTy) ty = maxTy + (ty - maxTy) * RUBBER_BAND;
		else if (ty < -maxTy) ty = -maxTy + (ty + maxTy) * RUBBER_BAND;
	}

	function applyScaleRubberBand(raw: number): number {
		if (raw < MIN_SCALE) return MIN_SCALE + (raw - MIN_SCALE) * RUBBER_BAND_SCALE;
		if (raw > MAX_SCALE) return MAX_SCALE + (raw - MAX_SCALE) * RUBBER_BAND_SCALE;
		return raw;
	}

	function settleTransform() {
		scale = clamp(scale, MIN_SCALE, MAX_SCALE);
		if (scale === MIN_SCALE) {
			tx = 0;
			ty = 0;
			return;
		}
		const { maxTx, maxTy } = getBounds();
		tx = clamp(tx, -maxTx, maxTx);
		ty = clamp(ty, -maxTy, maxTy);
	}

	function zoomAround(point: Point, newScale: number) {
		const c = viewportCenter();
		const localX = (point.x - c.x - tx) / scale;
		const localY = (point.y - c.y - ty) / scale;
		scale = clamp(newScale, MIN_SCALE, MAX_SCALE);
		tx = point.x - c.x - localX * scale;
		ty = point.y - c.y - localY * scale;
		settleTransform();
	}

	function handlePointerDown(e: PointerEvent) {
		pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

		if (pointers.size === 1) {
			pointerDownPos = { x: e.clientX, y: e.clientY };
			pointerDownTarget = e.target;
			movedDuringGesture = false;
			multiTouchOccurred = false;
			panStartTx = tx;
			panStartTy = ty;
			panStartPointer = { x: e.clientX, y: e.clientY };
		}

		if (pointers.size === 2) {
			multiTouchOccurred = true;
			isGesturing = true;
			const arr = [...pointers.values()];
			pinchStartDist = distance(arr[0], arr[1]);
			pinchStartScale = scale;
			pinchStartCenter = midpoint(arr[0], arr[1]);
			pinchStartTx = tx;
			pinchStartTy = ty;
		}
	}

	function handlePointerMove(e: PointerEvent) {
		if (!pointers.has(e.pointerId)) return;
		pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

		if (pointers.size >= 2 && pinchStartDist > 0) {
			e.preventDefault();
			isGesturing = true;
			movedDuringGesture = true;
			const arr = [...pointers.values()];
			const dist = distance(arr[0], arr[1]);
			const center = midpoint(arr[0], arr[1]);

			const rawScale = pinchStartScale * (dist / pinchStartDist);
			scale = applyScaleRubberBand(rawScale);

			const c = viewportCenter();
			const k = scale / pinchStartScale;
			tx =
				pinchStartTx * k +
				(center.x - pinchStartCenter.x) -
				k * (pinchStartCenter.x - c.x) +
				(pinchStartCenter.x - c.x);
			ty =
				pinchStartTy * k +
				(center.y - pinchStartCenter.y) -
				k * (pinchStartCenter.y - c.y) +
				(pinchStartCenter.y - c.y);
			applyPanRubberBand();
		} else if (pointers.size === 1) {
			const p = [...pointers.values()][0];
			const dx = p.x - pointerDownPos.x;
			const dy = p.y - pointerDownPos.y;
			if (Math.abs(dx) + Math.abs(dy) > TAP_SLOP) movedDuringGesture = true;

			if (scale > MIN_SCALE) {
				e.preventDefault();
				isGesturing = true;
				tx = panStartTx + (p.x - panStartPointer.x);
				ty = panStartTy + (p.y - panStartPointer.y);
				applyPanRubberBand();
			}
		}
	}

	function handlePointerEnd(e: PointerEvent) {
		const hadPointer = pointers.delete(e.pointerId);
		if (!hadPointer) return;

		if (pointers.size === 0) {
			isGesturing = false;
			settleTransform();

			const wasTap = !movedDuringGesture && !multiTouchOccurred;

			if (wasTap && e.pointerType === "touch" && pointerDownTarget === imgEl) {
				const now = performance.now();
				if (
					now - lastTapTime < DOUBLE_TAP_MS &&
					distance(lastTapPos, pointerDownPos) < DOUBLE_TAP_DIST
				) {
					handleDoubleTap(pointerDownPos);
					lastTapTime = 0;
				} else {
					lastTapTime = now;
					lastTapPos = { ...pointerDownPos };
				}
			}

			if (wasTap && scale === MIN_SCALE && pointerDownTarget === overlayEl) {
				onclose();
			}

			multiTouchOccurred = false;
			pinchStartDist = 0;
		} else if (pointers.size === 1) {
			// Transition from pinch back to single-finger pan: re-baseline so motion is continuous
			const p = [...pointers.values()][0];
			panStartPointer = { x: p.x, y: p.y };
			panStartTx = tx;
			panStartTy = ty;
			pinchStartDist = 0;
		}
	}

	function handleDoubleTap(pos: Point) {
		if (scale > 1.5) {
			scale = MIN_SCALE;
			tx = 0;
			ty = 0;
		} else {
			zoomAround(pos, DOUBLE_TAP_TARGET_SCALE);
		}
		hapticTap();
	}

	function handleWheel(e: WheelEvent) {
		if (e.ctrlKey) {
			e.preventDefault();
			const factor = Math.exp(-e.deltaY * 0.01);
			zoomAround({ x: e.clientX, y: e.clientY }, scale * factor);
		} else if (scale > MIN_SCALE) {
			e.preventDefault();
			tx -= e.deltaX;
			ty -= e.deltaY;
			settleTransform();
		}
	}

	function handleImageLoad() {
		captureBaseSize();
	}

	function handleResize() {
		captureBaseSize();
		settleTransform();
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === "Escape") {
			e.preventDefault();
			e.stopPropagation();
			onclose();
		}
	}

	onMount(() => {
		const originalOverflow = document.body.style.overflow;
		document.body.style.overflow = "hidden";

		overlayEl?.addEventListener("wheel", handleWheel, { passive: false });
		window.addEventListener("resize", handleResize);

		return () => {
			document.body.style.overflow = originalOverflow;
			overlayEl?.removeEventListener("wheel", handleWheel);
			window.removeEventListener("resize", handleResize);
		};
	});
</script>

<svelte:window onkeydown={handleKeydown} />

<Portal>
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		bind:this={overlayEl}
		class="lightbox-overlay fixed inset-0 z-50 grid place-items-center overflow-hidden bg-black/90 backdrop-blur-sm"
		onpointerdown={handlePointerDown}
		onpointermove={handlePointerMove}
		onpointerup={handlePointerEnd}
		onpointercancel={handlePointerEnd}
	>
		<!-- Close button -->
		<button
			class="absolute right-3 top-3 z-10 grid size-8 place-items-center rounded-full border border-white/25 bg-white/20 text-gray-300 hover:bg-white/30 sm:right-6 sm:top-6"
			onclick={onclose}
			aria-label="Close"
		>
			<CarbonClose />
		</button>

		<img
			bind:this={imgEl}
			{src}
			alt=""
			draggable="false"
			onload={handleImageLoad}
			class="lightbox-image h-auto max-h-[calc(100vh-160px)] w-auto max-w-full select-none"
			class:animating={!isGesturing}
			style="transform: translate3d({tx}px, {ty}px, 0) scale({scale});"
		/>
	</div>
</Portal>

<style>
	.lightbox-overlay {
		touch-action: none;
	}
	.lightbox-image {
		touch-action: none;
		transform-origin: center center;
		will-change: transform;
		-webkit-user-drag: none;
		-webkit-touch-callout: none;
	}
	.lightbox-image.animating {
		transition: transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1);
	}
</style>
