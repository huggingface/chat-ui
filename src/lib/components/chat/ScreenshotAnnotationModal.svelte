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
	/** Bumped to re-trigger the focus effect when editingIndex itself doesn't change */
	let focusNonce = $state(0);
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

	/**
	 * Topmost comment whose badge contains the point, for click-to-reopen.
	 * The hit target has a floor in screen pixels: on a heavily downscaled
	 * capture the badge's image-space radius can shrink to a couple of CSS
	 * pixels, which would make badges effectively unclickable.
	 */
	function commentIndexAt(point: Point): number | null {
		const canvas = canvasEl;
		const displayScale = canvas ? canvas.getBoundingClientRect().width / canvas.width : 1;
		const hitRadius = Math.max(
			badgeRadius * 1.4,
			displayScale > 0 ? 14 / displayScale : badgeRadius * 1.4
		);
		for (let i = comments.length - 1; i >= 0; i--) {
			if (Math.hypot(point.x - comments[i].x, point.y - comments[i].y) <= hitRadius) return i;
		}
		return null;
	}

	function onPointerDown(e: PointerEvent) {
		if (!image || e.button !== 0) return;
		// The canvas never needs focus: without this, a real mouse press moves
		// focus to the dialog AFTER this handler, and the resulting textarea
		// blur would immediately close or even delete the editor this handler
		// just opened (synthetic-event tests don't reproduce that default).
		e.preventDefault();
		const point = toImagePoint(e);
		if (!point) return;
		// A badge is clickable with any tool selected: clicking a number is an
		// unambiguous "show me this note". Clicking the badge of the note that's
		// already open keeps it open and pulls focus back to it (editingIndex
		// doesn't change on this path, so the focus effect needs the nudge).
		if (editingIndex !== null && commentIndexAt(point) === editingIndex) {
			focusNonce += 1;
			return;
		}
		// Settle any open editor first so indices are stable for the hit test
		// (an abandoned empty comment gets dropped here)
		commitEditing();
		const hit = commentIndexAt(point);
		if (hit !== null) {
			editingIndex = hit;
			return;
		}
		if (tool === "comment") {
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
		if (current) {
			current =
				current.tool === "pen"
					? { ...current, points: [...current.points, point] }
					: { ...current, points: [current.points[0], point] };
			return;
		}
		// Idle hover: badges advertise their clickability
		if (canvasEl) {
			canvasEl.style.cursor = commentIndexAt(point) !== null ? "pointer" : "";
		}
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

	function onNoteBlur(e: FocusEvent, index: number) {
		// A blur from a textarea that is no longer the active editor (its
		// popover target switched within the same interaction) must not commit
		// against the new editor's index
		if (editingIndex !== index) return;
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
	// Escape); otherwise it closes the whole modal. Modal dispatches the same
	// Escape twice when focus is inside the dialog (window capture listener
	// plus the dialog's own keydown), so duplicate calls within one event are
	// latched — otherwise the second call would fall through and close the
	// whole session right after the first one dismissed the editor.
	let closeRequestLatched = false;
	function requestClose() {
		if (closeRequestLatched) return;
		closeRequestLatched = true;
		queueMicrotask(() => (closeRequestLatched = false));
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

	// Focus when the token is set, and again whenever it changes: the popover
	// element survives switching between comments (the {#if} block never
	// unmounts), so a mount-only focus would miss badge-to-badge jumps
	function autofocus(node: HTMLElement, token: unknown = true) {
		function apply(value: unknown) {
			if (value === false || value === null || value === undefined) return;
			// Deferred a task: focusing a just-mounted element synchronously
			// during the render flush doesn't reliably stick. setTimeout rather
			// than requestAnimationFrame — rAF can be throttled to never when the
			// page isn't actively compositing.
			setTimeout(() => {
				if (node.isConnected) {
					node.focus();
					node.scrollIntoView({ block: "nearest" });
				}
			}, 0);
		}
		apply(token);
		return {
			update: apply,
		};
	}

	/** Keep a note textarea as tall as its content (capped by CSS max-height) */
	function autogrow(node: HTMLTextAreaElement) {
		function resize() {
			node.style.height = "auto";
			node.style.height = `${node.scrollHeight}px`;
		}
		resize();
		node.addEventListener("input", resize);
		return {
			destroy() {
				node.removeEventListener("input", resize);
			},
		};
	}

	/** Enter commits the note, Shift+Enter inserts a newline */
	function onNoteKeydown(e: KeyboardEvent) {
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			(e.target as HTMLTextAreaElement).blur();
		}
	}

	// Popover focus is driven by state, not element mount: mount-time focus
	// proved unreliable for the reopen path. The popover element is read lazily
	// inside the deferred attempts (untracked on purpose) with a short bounded
	// retry, so the effect doesn't depend on bind:this flush ordering.
	$effect(() => {
		if (isNarrow || editingIndex === null) return;
		void comments[editingIndex]?.id;
		void focusNonce;
		let cancelled = false;
		let tries = 0;
		const attempt = () => {
			if (cancelled) return;
			const target = popoverEl?.querySelector("textarea");
			if (target) {
				target.focus();
				return;
			}
			if (++tries < 10) setTimeout(attempt, 16);
		};
		setTimeout(attempt, 0);
		return () => {
			cancelled = true;
		};
	});

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
		const width = 280;
		const left = Math.min(
			Math.max(8, badgeX + badgeRadius * scaleX + 8),
			wrapRect.width - width - 8
		);
		// Bottom clamp leaves room for the textarea to grow a few lines
		// Reserve the popover's full potential height (textarea max-h-32 = 128px
		// plus padding and borders): the wrapper is overflow-hidden, so a short
		// reserve would clip long multiline notes near the bottom edge
		const top = Math.min(Math.max(8, badgeY + badgeRadius * scaleY + 8), wrapRect.height - 150);
		popoverStyle = `left:${left}px; top:${top}px; width:${width}px;`;
	});

	const toolBtnBase =
		"btn rounded-md px-2 py-1.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40";
	const toolBtnActive = "bg-white text-gray-800 shadow-xs dark:bg-gray-600 dark:text-gray-100";
	const toolBtnInactive =
		"text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200";
	const noteInput =
		"scrollbar-custom max-h-32 min-w-0 flex-1 resize-none overflow-y-auto rounded-md border border-gray-200 bg-white px-2 py-1 text-sm leading-snug text-gray-800 outline-hidden placeholder:text-gray-400 focus:border-blue-400 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-200 dark:focus:border-blue-500";
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
				<!-- ownIndex freezes which comment this editor instance belongs to:
				     the blur handler must not act when the editing target has
				     already moved on (stale blur committing against the new index) -->
				{@const ownIndex = editingIndex}
				<div
					bind:this={popoverEl}
					class="absolute z-10 flex items-start gap-1.5 rounded-lg border border-gray-200 bg-white p-1.5 shadow-lg dark:border-gray-600 dark:bg-gray-800"
					style={popoverStyle}
				>
					<span
						class="mt-0.5 flex size-5 flex-none items-center justify-center rounded-full bg-blue-500 text-xs font-semibold text-white"
					>
						{editingIndex + 1}
					</span>
					{#key comments[editingIndex].id}
						<textarea
							rows="1"
							class={noteInput}
							placeholder="What about this area?"
							bind:value={comments[editingIndex].note}
							onkeydown={onNoteKeydown}
							onblur={(e) => onNoteBlur(e, ownIndex)}
							use:autogrow
						></textarea>
					{/key}
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
					<li class="flex items-start gap-2">
						<span
							class="mt-1 flex size-5 flex-none items-center justify-center rounded-full bg-blue-500 text-xs font-semibold text-white"
						>
							{i + 1}
						</span>
						<textarea
							rows="1"
							class={noteInput}
							placeholder="What about this area?"
							bind:value={comment.note}
							onkeydown={onNoteKeydown}
							onblur={() => onRowBlur(i)}
							use:autofocus={editingIndex === i ? editingIndex : null}
							use:autogrow
						></textarea>
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
