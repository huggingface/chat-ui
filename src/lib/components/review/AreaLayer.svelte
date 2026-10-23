<script lang="ts">
	import type { ReviewArea } from "$lib/types/MlReview";
	import { MIN_AREA, areaBetween } from "$lib/utils/review/anchors";

	interface Props {
		boxes: { id: string; n: number; area: ReviewArea }[];
		/** the box a comment is being written for, drawn until it is saved or dropped */
		pending?: ReviewArea;
		drawing: boolean;
		ondraw: (area: ReviewArea) => void;
		/** Escape stops drawing, absent where drawing is always on and Escape belongs to the pane */
		oncancel?: () => void;
	}

	let { boxes, pending, drawing, ondraw, oncancel }: Props = $props();

	let layer: HTMLDivElement | undefined = $state();
	let from = $state<{ x: number; y: number } | undefined>(undefined);
	let to = $state<{ x: number; y: number } | undefined>(undefined);
	let draft = $derived(from && to ? areaBetween(from, to) : undefined);
	let shown = $derived(draft ?? pending);

	const at = (e: PointerEvent) => {
		const box = layer?.getBoundingClientRect();
		if (!box || box.width === 0 || box.height === 0) return { x: 0, y: 0 };
		return { x: (e.clientX - box.left) / box.width, y: (e.clientY - box.top) / box.height };
	};

	const style = (area: ReviewArea) =>
		`left: ${area.x * 100}%; top: ${area.y * 100}%; width: ${area.w * 100}%; height: ${area.h * 100}%`;

	$effect(() => {
		if (!drawing) return;
		const onkey = (e: KeyboardEvent) => {
			if (e.key !== "Escape") return;
			const target = e.target;
			// a comment box's own Escape closes the box, it must not also stop drawing
			if (target instanceof HTMLElement && ["INPUT", "TEXTAREA"].includes(target.tagName)) return;
			if (!from && !oncancel) return;
			e.preventDefault();
			e.stopPropagation();
			if (from) from = to = undefined;
			else oncancel?.();
		};
		window.addEventListener("keydown", onkey, true);
		return () => window.removeEventListener("keydown", onkey, true);
	});
</script>

<div
	bind:this={layer}
	class={["absolute inset-0", drawing ? "cursor-crosshair touch-none" : "pointer-events-none"]}
	data-area-layer
	role="presentation"
	onpointerdown={(e) => {
		if (!drawing || e.button !== 0) return;
		e.preventDefault();
		layer?.setPointerCapture(e.pointerId);
		from = to = at(e);
	}}
	onpointermove={(e) => {
		if (from) to = at(e);
	}}
	onpointerup={(e) => {
		if (!from) return;
		const area = areaBetween(from, at(e));
		from = to = undefined;
		if (area.w >= MIN_AREA && area.h >= MIN_AREA) ondraw(area);
	}}
>
	{#each boxes as box (box.id)}
		<div
			class="absolute rounded-md border-2 border-dashed border-amber-500 dark:border-amber-400"
			style={style(box.area)}
			data-area-box={box.n}
		>
			<span
				class="absolute -top-3 -left-3 flex size-6 items-center justify-center rounded-full bg-amber-500 text-xs font-bold text-gray-900 shadow-[0_1px_4px_rgba(0,0,0,0.25)] dark:bg-amber-400"
			>
				{box.n}
			</span>
		</div>
	{/each}
	{#if shown}
		<div
			class="absolute rounded-md border-2 border-dashed border-amber-500 bg-amber-400/10 dark:border-amber-400"
			style={style(shown)}
		></div>
	{/if}
</div>
