<script lang="ts">
	import Modal from "../Modal.svelte";

	import LucideMoveUpRight from "~icons/lucide/move-up-right";
	import LucidePencil from "~icons/lucide/pencil";
	import LucideSquare from "~icons/lucide/square";
	import LucideUndo2 from "~icons/lucide/undo-2";
	import LucideTrash2 from "~icons/lucide/trash-2";
	import EosIconsLoading from "~icons/eos-icons/loading";

	type Tool = "arrow" | "pen" | "rect";
	interface Point {
		x: number;
		y: number;
	}
	/** One drawn shape, in image-space coordinates (canvas pixels, not CSS pixels) */
	interface Annotation {
		tool: Tool;
		color: string;
		points: Point[];
	}

	interface Props {
		/** PNG data URL of the captured screenshot */
		dataUrl: string;
		/** Called with the final (annotated) PNG data URL */
		onconfirm: (dataUrl: string) => void;
		onclose: () => void;
	}

	let { dataUrl, onconfirm, onclose }: Props = $props();

	const COLORS = ["#ef4444", "#f59e0b", "#3b82f6", "#22c55e"];
	const TOOLS: { id: Tool; label: string; icon: typeof LucidePencil }[] = [
		{ id: "arrow", label: "Arrow", icon: LucideMoveUpRight },
		{ id: "pen", label: "Pen", icon: LucidePencil },
		{ id: "rect", label: "Rectangle", icon: LucideSquare },
	];

	let tool = $state<Tool>("arrow");
	let color = $state(COLORS[0]);
	let annotations = $state<Annotation[]>([]);
	let current = $state<Annotation | null>(null);

	let canvasEl: HTMLCanvasElement | undefined = $state();
	let image = $state<HTMLImageElement | null>(null);
	let loadFailed = $state(false);

	$effect(() => {
		const img = new Image();
		let cancelled = false;
		img.onload = () => {
			if (!cancelled) image = img;
		};
		img.onerror = () => {
			if (!cancelled) loadFailed = true;
		};
		img.src = dataUrl;
		return () => {
			// A new dataUrl replaces the whole session: drawings made on the old
			// image must not carry over to the new one
			cancelled = true;
			annotations = [];
			current = null;
			loadFailed = false;
		};
	});

	// Stroke width scales with the capture so annotations stay legible whether
	// the shot is a 400px widget or a 4096px page
	let strokeWidth = $derived(
		image ? Math.max(3, Math.round(Math.max(image.naturalWidth, image.naturalHeight) / 350)) : 3
	);

	function drawAnnotation(ctx: CanvasRenderingContext2D, annotation: Annotation) {
		const pts = annotation.points;
		if (pts.length === 0) return;
		ctx.strokeStyle = annotation.color;
		ctx.fillStyle = annotation.color;
		ctx.lineWidth = strokeWidth;
		ctx.lineCap = "round";
		ctx.lineJoin = "round";

		if (annotation.tool === "pen") {
			if (pts.length === 1) {
				ctx.beginPath();
				ctx.arc(pts[0].x, pts[0].y, strokeWidth / 2, 0, Math.PI * 2);
				ctx.fill();
				return;
			}
			// Midpoint smoothing so fast strokes don't look like polylines
			ctx.beginPath();
			ctx.moveTo(pts[0].x, pts[0].y);
			for (let i = 1; i < pts.length - 1; i++) {
				const midX = (pts[i].x + pts[i + 1].x) / 2;
				const midY = (pts[i].y + pts[i + 1].y) / 2;
				ctx.quadraticCurveTo(pts[i].x, pts[i].y, midX, midY);
			}
			ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
			ctx.stroke();
			return;
		}

		const start = pts[0];
		const end = pts[pts.length - 1];
		if (annotation.tool === "rect") {
			ctx.strokeRect(
				Math.min(start.x, end.x),
				Math.min(start.y, end.y),
				Math.abs(end.x - start.x),
				Math.abs(end.y - start.y)
			);
			return;
		}

		// Arrow: shaft stops short of the tip so it doesn't poke through the head
		const angle = Math.atan2(end.y - start.y, end.x - start.x);
		const head = strokeWidth * 3.5;
		ctx.beginPath();
		ctx.moveTo(start.x, start.y);
		ctx.lineTo(end.x - Math.cos(angle) * head * 0.6, end.y - Math.sin(angle) * head * 0.6);
		ctx.stroke();
		ctx.beginPath();
		ctx.moveTo(end.x, end.y);
		ctx.lineTo(
			end.x - head * Math.cos(angle - Math.PI / 6),
			end.y - head * Math.sin(angle - Math.PI / 6)
		);
		ctx.lineTo(
			end.x - head * Math.cos(angle + Math.PI / 6),
			end.y - head * Math.sin(angle + Math.PI / 6)
		);
		ctx.closePath();
		ctx.fill();
	}

	// Full redraw on every change: the canvas holds the composited image at
	// natural resolution, so confirm() is just toDataURL on it
	$effect(() => {
		const canvas = canvasEl;
		const img = image;
		if (!canvas || !img) return;
		void annotations;
		void current;
		const ctx = canvas.getContext("2d");
		if (!ctx) return;
		ctx.clearRect(0, 0, canvas.width, canvas.height);
		ctx.drawImage(img, 0, 0);
		for (const annotation of annotations) drawAnnotation(ctx, annotation);
		if (current) drawAnnotation(ctx, current);
	});

	function toImagePoint(e: PointerEvent): Point | null {
		const canvas = canvasEl;
		if (!canvas) return null;
		const rect = canvas.getBoundingClientRect();
		if (rect.width === 0 || rect.height === 0) return null;
		return {
			x: Math.min(Math.max(((e.clientX - rect.left) / rect.width) * canvas.width, 0), canvas.width),
			y: Math.min(
				Math.max(((e.clientY - rect.top) / rect.height) * canvas.height, 0),
				canvas.height
			),
		};
	}

	function onPointerDown(e: PointerEvent) {
		if (!image || e.button !== 0) return;
		const point = toImagePoint(e);
		if (!point) return;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		current = { tool, color, points: [point] };
	}

	function onPointerMove(e: PointerEvent) {
		if (!current) return;
		const point = toImagePoint(e);
		if (!point) return;
		current =
			current.tool === "pen"
				? { ...current, points: [...current.points, point] }
				: { ...current, points: [current.points[0], point] };
	}

	function onPointerUp() {
		if (!current) return;
		const pts = current.points;
		const moved =
			pts.length > 1 &&
			Math.hypot(pts[pts.length - 1].x - pts[0].x, pts[pts.length - 1].y - pts[0].y) >= strokeWidth;
		// A pen tap leaves a visible dot; a zero-size arrow or rectangle would
		// just be clutter, so clicks without a drag are discarded for those
		if (current.tool === "pen" || moved) {
			annotations = [...annotations, current];
		}
		current = null;
	}

	function onPointerCancel() {
		current = null;
	}

	function undo() {
		annotations = annotations.slice(0, -1);
	}

	function clearAll() {
		annotations = [];
		current = null;
	}

	function onKeydown(e: KeyboardEvent) {
		if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === "z") {
			e.preventDefault();
			undo();
		}
	}

	function confirm() {
		if (!canvasEl || !image) return;
		onconfirm(canvasEl.toDataURL("image/png"));
	}

	const toolBtnBase =
		"btn rounded-md px-2 py-1.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40";
	const toolBtnActive = "bg-white text-gray-800 shadow-xs dark:bg-gray-600 dark:text-gray-100";
	const toolBtnInactive =
		"text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200";
</script>

<svelte:window onkeydown={onKeydown} />

<!-- Width override needs the important marker: Modal's own max-w-[90dvw] targets
     the same property and stylesheet order between two utilities isn't guaranteed.
     min() keeps the desktop cap at 64rem while mobile stretches nearly edge to
     edge so the screenshot gets the room. -->
<Modal width="max-w-[min(64rem,calc(100dvw-0.75rem))]!" closeOnBackdrop={false} {onclose}>
	<div class="flex flex-col gap-2.5 p-2.5 sm:gap-3 sm:p-4">
		<div class="flex flex-wrap items-center gap-x-1.5 gap-y-2 sm:gap-2">
			<h2 class="mr-auto text-sm font-semibold text-gray-800 dark:text-gray-200">
				Annotate screenshot
			</h2>

			<div class="flex items-center rounded-lg bg-gray-100 p-0.5 dark:bg-gray-800">
				{#each TOOLS as toolOption (toolOption.id)}
					<button
						type="button"
						class="{toolBtnBase} {tool === toolOption.id ? toolBtnActive : toolBtnInactive}"
						title={toolOption.label}
						aria-pressed={tool === toolOption.id}
						onclick={() => (tool = toolOption.id)}
					>
						<toolOption.icon />
					</button>
				{/each}
			</div>

			<div class="flex items-center gap-1.5 px-1">
				{#each COLORS as colorOption (colorOption)}
					<button
						type="button"
						class="size-4.5 rounded-full transition-transform hover:scale-110 {color === colorOption
							? 'ring-2 ring-gray-500 ring-offset-2 dark:ring-gray-300 dark:ring-offset-gray-800'
							: ''}"
						style="background-color: {colorOption}"
						title="Draw in this color"
						aria-pressed={color === colorOption}
						onclick={() => (color = colorOption)}
					></button>
				{/each}
			</div>

			<div class="flex items-center gap-0.5 text-gray-500 dark:text-gray-400">
				<button
					type="button"
					class="btn rounded-md p-1.5 text-xs hover:bg-gray-100 hover:text-gray-600 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-gray-800 dark:hover:text-gray-300"
					title="Undo (Ctrl+Z)"
					disabled={annotations.length === 0}
					onclick={undo}
				>
					<LucideUndo2 />
				</button>
				<button
					type="button"
					class="btn rounded-md p-1.5 text-xs hover:bg-gray-100 hover:text-gray-600 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-gray-800 dark:hover:text-gray-300"
					title="Clear all annotations"
					disabled={annotations.length === 0}
					onclick={clearAll}
				>
					<LucideTrash2 />
				</button>
			</div>
		</div>

		<!-- On mobile the image bleeds to the modal edges (negative margin swallows
		     the container padding) so every horizontal pixel goes to the screenshot -->
		<div
			class="flex min-h-40 items-center justify-center overflow-hidden rounded-lg border border-gray-200 bg-gray-50 max-sm:-mx-2.5 max-sm:rounded-none max-sm:border-x-0 dark:border-gray-700 dark:bg-gray-950"
		>
			{#if loadFailed}
				<p class="p-8 text-sm text-gray-500">Could not load the screenshot.</p>
			{:else if !image}
				<EosIconsLoading class="text-2xl text-gray-400" />
			{:else}
				<canvas
					bind:this={canvasEl}
					width={image.naturalWidth}
					height={image.naturalHeight}
					class="max-h-[75dvh] max-w-full cursor-crosshair touch-none select-none max-sm:max-h-[76dvh]"
					onpointerdown={onPointerDown}
					onpointermove={onPointerMove}
					onpointerup={onPointerUp}
					onpointercancel={onPointerCancel}
				></canvas>
			{/if}
		</div>

		<div class="flex items-center justify-end gap-2">
			<button
				type="button"
				class="btn rounded-xl px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
				onclick={() => onclose()}
			>
				Cancel
			</button>
			<button
				type="button"
				class="inline-flex items-center gap-1.5 rounded-xl border border-gray-900 bg-gray-900 px-3 py-1.5 text-sm font-semibold text-white hover:bg-black focus:ring-2 focus:ring-gray-400 focus:ring-offset-2 focus:outline-hidden disabled:opacity-60 dark:border-gray-100 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-white dark:focus:ring-offset-gray-800"
				disabled={!image}
				onclick={confirm}
			>
				Add to chat
			</button>
		</div>
	</div>
</Modal>
