<script lang="ts">
	import Modal from "../Modal.svelte";

	import LucideMessageSquareText from "~icons/lucide/message-square-text";
	import LucideMoveUpRight from "~icons/lucide/move-up-right";
	import LucidePencil from "~icons/lucide/pencil";
	import LucideSquare from "~icons/lucide/square";
	import LucideUndo2 from "~icons/lucide/undo-2";
	import LucideTrash2 from "~icons/lucide/trash-2";
	import LucideX from "~icons/lucide/x";
	import EosIconsLoading from "~icons/eos-icons/loading";

	type Tool = "comment" | "arrow" | "pen" | "rect";
	interface Point {
		x: number;
		y: number;
	}
	/** One drawn shape, in image-space coordinates (canvas pixels, not CSS pixels) */
	interface Annotation {
		tool: "arrow" | "pen" | "rect";
		color: string;
		points: Point[];
	}
	/**
	 * A numbered note anchored to a point (pin: w = h = 0) or a dragged region.
	 * The badge and dashed outline are baked into the exported image; the note
	 * text travels as plain text next to it (see formatScreenshotNotes), so no
	 * user text is ever rasterized.
	 */
	interface CommentAnnotation {
		id: number;
		x: number;
		y: number;
		w: number;
		h: number;
		note: string;
	}

	interface Props {
		/** PNG data URL of the captured screenshot */
		dataUrl: string;
		/** Called with the final (annotated) PNG data URL and the numbered note texts */
		onconfirm: (dataUrl: string, notes: string[]) => void;
		onclose: () => void;
	}

	let { dataUrl, onconfirm, onclose }: Props = $props();

	const COLORS = ["#ef4444", "#f59e0b", "#3b82f6", "#22c55e"];
	// Comments keep one fixed identity (blue badge, dashed region) so they read
	// as "referenced note" rather than a drawing; the palette only affects the
	// drawing tools
	const COMMENT_COLOR = "#3b82f6";
	const TOOLS: { id: Tool; label: string; icon: typeof LucidePencil }[] = [
		{ id: "comment", label: "Comment", icon: LucideMessageSquareText },
		{ id: "arrow", label: "Arrow", icon: LucideMoveUpRight },
		{ id: "pen", label: "Pen", icon: LucidePencil },
		{ id: "rect", label: "Rectangle", icon: LucideSquare },
	];

	let tool = $state<Tool>("comment");
	let color = $state(COLORS[0]);
	let annotations = $state<Annotation[]>([]);
	let current = $state<Annotation | null>(null);
	let comments = $state<CommentAnnotation[]>([]);
	/** Index into comments whose note is being edited (desktop popover target) */
	let editingIndex = $state<number | null>(null);
	/** Live drag preview for the comment tool, kept as origin + pointer */
	let draftRegion = $state<{ ox: number; oy: number; px: number; py: number } | null>(null);
	let nextCommentId = 0;

	let canvasEl: HTMLCanvasElement | undefined = $state();
	let containerEl: HTMLDivElement | undefined = $state();
	let popoverEl: HTMLDivElement | undefined = $state();
	let image = $state<HTMLImageElement | null>(null);
	let loadFailed = $state(false);
	let resizeNonce = $state(0);

	// Below sm the note editor is an in-flow list instead of an anchored
	// popover: a floating input mid-canvas loses against the on-screen keyboard
	let isNarrow = $state(false);
	$effect(() => {
		const mq = window.matchMedia("(max-width: 639px)");
		isNarrow = mq.matches;
		const onChange = () => (isNarrow = mq.matches);
		mq.addEventListener("change", onChange);
		return () => mq.removeEventListener("change", onChange);
	});

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
			comments = [];
			editingIndex = null;
			draftRegion = null;
			loadFailed = false;
		};
	});

	// Stroke width scales with the capture so annotations stay legible whether
	// the shot is a 400px widget or a 4096px page
	let strokeWidth = $derived(
		image ? Math.max(3, Math.round(Math.max(image.naturalWidth, image.naturalHeight) / 350)) : 3
	);
	let badgeRadius = $derived(Math.max(9, strokeWidth * 2.4));

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

	function drawCommentMarker(
		ctx: CanvasRenderingContext2D,
		comment: { x: number; y: number; w: number; h: number },
		label: string | null
	) {
		const outlineWidth = Math.max(2, strokeWidth * 0.8);
		if (comment.w > 0 || comment.h > 0) {
			ctx.strokeStyle = COMMENT_COLOR;
			ctx.lineWidth = outlineWidth;
			ctx.lineCap = "butt";
			ctx.setLineDash([strokeWidth * 2, strokeWidth * 1.5]);
			ctx.strokeRect(comment.x, comment.y, comment.w, comment.h);
			ctx.setLineDash([]);
		}
		if (label === null) return;
		// Badge sits on the pin point / the region's top-left corner, with a
		// white halo so the number stays readable on any background
		ctx.beginPath();
		ctx.arc(comment.x, comment.y, badgeRadius, 0, Math.PI * 2);
		ctx.fillStyle = COMMENT_COLOR;
		ctx.fill();
		ctx.lineWidth = Math.max(1.5, strokeWidth * 0.5);
		ctx.strokeStyle = "#ffffff";
		ctx.beginPath();
		ctx.arc(comment.x, comment.y, badgeRadius, 0, Math.PI * 2);
		ctx.stroke();
		ctx.fillStyle = "#ffffff";
		ctx.font = `600 ${Math.round(badgeRadius * 1.1)}px system-ui, sans-serif`;
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";
		ctx.fillText(label, comment.x, comment.y + badgeRadius * 0.06);
	}

	function normalizedDraft(region: { ox: number; oy: number; px: number; py: number }) {
		return {
			x: Math.min(region.ox, region.px),
			y: Math.min(region.oy, region.py),
			w: Math.abs(region.px - region.ox),
			h: Math.abs(region.py - region.oy),
		};
	}

	// Full redraw: the canvas holds the composited image at natural resolution,
	// so exporting is just toDataURL on it. Called from the tracking effect (its
	// state reads register the dependencies) and synchronously before export.
	function redraw() {
		const canvas = canvasEl;
		const img = image;
		if (!canvas || !img) return;
		const ctx = canvas.getContext("2d");
		if (!ctx) return;
		ctx.clearRect(0, 0, canvas.width, canvas.height);
		ctx.drawImage(img, 0, 0);
		for (const annotation of annotations) drawAnnotation(ctx, annotation);
		if (current) drawAnnotation(ctx, current);
		comments.forEach((comment, i) => drawCommentMarker(ctx, comment, String(i + 1)));
		if (draftRegion) drawCommentMarker(ctx, normalizedDraft(draftRegion), null);
	}
	$effect(() => {
		redraw();
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

	/** Topmost comment whose badge contains the point, for click-to-reopen */
	function commentIndexAt(point: Point): number | null {
		const hitRadius = badgeRadius * 1.4;
		for (let i = comments.length - 1; i >= 0; i--) {
			if (Math.hypot(point.x - comments[i].x, point.y - comments[i].y) <= hitRadius) return i;
		}
		return null;
	}

	function onPointerDown(e: PointerEvent) {
		if (!image || e.button !== 0) return;
		const point = toImagePoint(e);
		if (!point) return;
		if (tool === "comment") {
			// Runs before the open editor's blur: settle it first so indices are
			// stable for the hit test below
			commitEditing();
			const hit = commentIndexAt(point);
			if (hit !== null) {
				editingIndex = hit;
				return;
			}
			(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
			draftRegion = { ox: point.x, oy: point.y, px: point.x, py: point.y };
			return;
		}
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		current = { tool, color, points: [point] };
	}

	function onPointerMove(e: PointerEvent) {
		const point = toImagePoint(e);
		if (!point) return;
		if (draftRegion) {
			draftRegion = { ...draftRegion, px: point.x, py: point.y };
			return;
		}
		if (!current) return;
		current =
			current.tool === "pen"
				? { ...current, points: [...current.points, point] }
				: { ...current, points: [current.points[0], point] };
	}

	function onPointerUp() {
		if (draftRegion) {
			const rect = normalizedDraft(draftRegion);
			const moved = Math.hypot(rect.w, rect.h) >= strokeWidth;
			// Click = pin (zero-size), drag = region; either way the editor opens
			comments = [
				...comments,
				moved
					? { id: nextCommentId++, ...rect, note: "" }
					: { id: nextCommentId++, x: draftRegion.ox, y: draftRegion.oy, w: 0, h: 0, note: "" },
			];
			editingIndex = comments.length - 1;
			draftRegion = null;
			return;
		}
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
		draftRegion = null;
	}

	/** Close the note editor; a comment left with an empty note is discarded */
	function commitEditing() {
		if (editingIndex === null) return;
		const index = editingIndex;
		editingIndex = null;
		const comment = comments[index];
		if (comment && !comment.note.trim()) {
			comments = comments.filter((_, i) => i !== index);
		}
	}

	function deleteComment(index: number) {
		comments = comments.filter((_, i) => i !== index);
		if (editingIndex === index) editingIndex = null;
		else if (editingIndex !== null && editingIndex > index) editingIndex -= 1;
	}

	function onNoteBlur(e: FocusEvent) {
		// Focus moving within the popover (to its delete button) isn't a dismissal
		if (popoverEl && e.relatedTarget instanceof Node && popoverEl.contains(e.relatedTarget)) return;
		commitEditing();
	}

	/** Blur handler for mobile list rows: empty rows evaporate on leave */
	function onRowBlur(index: number) {
		if (editingIndex === index) editingIndex = null;
		const comment = comments[index];
		if (comment && !comment.note.trim()) deleteComment(index);
	}

	function undo() {
		annotations = annotations.slice(0, -1);
	}

	function clearAll() {
		annotations = [];
		current = null;
		comments = [];
		editingIndex = null;
		draftRegion = null;
	}

	function onKeydown(e: KeyboardEvent) {
		// Typing in a note input keeps native text editing shortcuts
		const target = e.target as HTMLElement | null;
		if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
		if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === "z") {
			e.preventDefault();
			undo();
		}
	}

	// Escape reaches us through Modal's onclose: with a note editor open it
	// dismisses just the editor (mirroring how the panel's nested modals handle
	// Escape); otherwise it closes the whole modal
	function requestClose() {
		if (editingIndex !== null) {
			commitEditing();
			return;
		}
		onclose();
	}

	function confirm() {
		if (!canvasEl || !image) return;
		commitEditing();
		// Sweep any stragglers so no unnumbered/empty badge gets baked, then
		// repaint synchronously: the effect redraw only lands next flush
		comments = comments.filter((comment) => comment.note.trim());
		redraw();
		onconfirm(
			canvasEl.toDataURL("image/png"),
			comments.map((comment) => comment.note.trim())
		);
	}

	function autofocus(node: HTMLElement, enabled: boolean = true) {
		if (enabled) node.focus();
	}

	// ----- desktop popover positioning (image space -> container CSS space) -----
	let popoverStyle = $state("");
	$effect(() => {
		void resizeNonce;
		if (editingIndex === null || isNarrow) return;
		const comment = comments[editingIndex];
		const canvas = canvasEl;
		const wrap = containerEl;
		if (!comment || !canvas || !wrap) return;
		const canvasRect = canvas.getBoundingClientRect();
		const wrapRect = wrap.getBoundingClientRect();
		if (canvasRect.width === 0 || canvas.width === 0) return;
		const scaleX = canvasRect.width / canvas.width;
		const scaleY = canvasRect.height / canvas.height;
		const badgeX = canvasRect.left - wrapRect.left + comment.x * scaleX;
		const badgeY = canvasRect.top - wrapRect.top + comment.y * scaleY;
		const width = 264;
		const left = Math.min(
			Math.max(8, badgeX + badgeRadius * scaleX + 8),
			wrapRect.width - width - 8
		);
		const top = Math.min(Math.max(8, badgeY + badgeRadius * scaleY + 8), wrapRect.height - 56);
		popoverStyle = `left:${left}px; top:${top}px; width:${width}px;`;
	});

	const toolBtnBase =
		"btn rounded-md px-2 py-1.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40";
	const toolBtnActive = "bg-white text-gray-800 shadow-xs dark:bg-gray-600 dark:text-gray-100";
	const toolBtnInactive =
		"text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200";
	const noteInput =
		"min-w-0 flex-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-sm text-gray-800 outline-hidden placeholder:text-gray-400 focus:border-blue-400 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-200 dark:focus:border-blue-500";
</script>

<svelte:window onkeydown={onKeydown} onresize={() => (resizeNonce += 1)} />

<!-- Width override needs the important marker: Modal's own max-w-[90dvw] targets
     the same property and stylesheet order between two utilities isn't guaranteed.
     min() keeps the desktop cap at 64rem while mobile stretches nearly edge to
     edge so the screenshot gets the room. -->
<Modal
	width="max-w-[min(64rem,calc(100dvw-0.75rem))]!"
	closeOnBackdrop={false}
	onclose={requestClose}
>
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

			<!-- The palette only applies to the drawing tools; comments keep their
			     fixed identity, so the swatches mute while the comment tool is active -->
			<div
				class="flex items-center gap-1.5 px-1 {tool === 'comment'
					? 'pointer-events-none opacity-40'
					: ''}"
			>
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
					title="Undo drawing (Ctrl+Z)"
					disabled={annotations.length === 0}
					onclick={undo}
				>
					<LucideUndo2 />
				</button>
				<button
					type="button"
					class="btn rounded-md p-1.5 text-xs hover:bg-gray-100 hover:text-gray-600 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-gray-800 dark:hover:text-gray-300"
					title="Clear all annotations"
					disabled={annotations.length === 0 && comments.length === 0}
					onclick={clearAll}
				>
					<LucideTrash2 />
				</button>
			</div>
		</div>

		<!-- On mobile the image bleeds to the modal edges (negative margin swallows
		     the container padding) so every horizontal pixel goes to the screenshot -->
		<div
			bind:this={containerEl}
			class="relative flex min-h-40 items-center justify-center overflow-hidden rounded-lg border border-gray-200 bg-gray-50 max-sm:-mx-2.5 max-sm:rounded-none max-sm:border-x-0 dark:border-gray-700 dark:bg-gray-950"
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
					class="max-h-[75dvh] max-w-full cursor-crosshair touch-none select-none max-sm:max-h-[70dvh]"
					onpointerdown={onPointerDown}
					onpointermove={onPointerMove}
					onpointerup={onPointerUp}
					onpointercancel={onPointerCancel}
				></canvas>
			{/if}

			{#if !isNarrow && editingIndex !== null && comments[editingIndex]}
				<div
					bind:this={popoverEl}
					class="absolute z-10 flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white p-1.5 shadow-lg dark:border-gray-600 dark:bg-gray-800"
					style={popoverStyle}
				>
					<span
						class="flex size-5 flex-none items-center justify-center rounded-full bg-blue-500 text-xs font-semibold text-white"
					>
						{editingIndex + 1}
					</span>
					<input
						type="text"
						class={noteInput}
						placeholder="What about this area?"
						bind:value={comments[editingIndex].note}
						onkeydown={(e) => e.key === "Enter" && commitEditing()}
						onblur={onNoteBlur}
						use:autofocus
					/>
					<button
						type="button"
						class="btn flex-none rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300"
						title="Delete note"
						onpointerdown={(e) => {
							e.preventDefault();
							if (editingIndex !== null) deleteComment(editingIndex);
						}}
					>
						<LucideX />
					</button>
				</div>
			{/if}
		</div>

		{#if isNarrow && comments.length > 0}
			<ul class="flex flex-col gap-1.5">
				{#each comments as comment, i (comment.id)}
					<li class="flex items-center gap-2">
						<span
							class="flex size-5 flex-none items-center justify-center rounded-full bg-blue-500 text-xs font-semibold text-white"
						>
							{i + 1}
						</span>
						<input
							type="text"
							class={noteInput}
							placeholder="What about this area?"
							bind:value={comment.note}
							onkeydown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
							onblur={() => onRowBlur(i)}
							use:autofocus={editingIndex === i}
						/>
						<button
							type="button"
							class="btn flex-none rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
							title="Delete note"
							onpointerdown={(e) => {
								e.preventDefault();
								deleteComment(i);
							}}
						>
							<LucideX />
						</button>
					</li>
				{/each}
			</ul>
		{/if}

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
