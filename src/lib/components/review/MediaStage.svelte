<script lang="ts">
	import type { ReviewArea, ReviewComment, ReviewTime } from "$lib/types/MlReview";
	import {
		formatClock,
		pinNumbers,
		timeAt,
		timeCovers,
		type MediaFieldType,
	} from "$lib/utils/review/anchors";
	import { imageUrl } from "$lib/utils/review/view";
	import AnchoredNotes from "./AnchoredNotes.svelte";
	import AreaLayer from "./AreaLayer.svelte";
	import { claimMediaKeys } from "./mediaKeys";

	import CarbonChat from "~icons/carbon/chat";
	import CarbonPause from "~icons/carbon/pause-filled";
	import CarbonPlay from "~icons/carbon/play-filled-alt";
	import CarbonSkipBack from "~icons/carbon/skip-back";
	import CarbonSkipForward from "~icons/carbon/skip-forward";
	import CarbonRepeat from "~icons/carbon/repeat";
	import CarbonMaximize from "~icons/carbon/maximize";
	import CarbonCenterSquare from "~icons/carbon/center-square";

	interface Props {
		kind: MediaFieldType;
		value: unknown;
		/** the media route for a value the server does not store */
		src?: string;
		comments: ReviewComment[];
		pending?: ReviewArea;
		editable: boolean;
		/** the record's lead player answers the pane's Space, arrow, C and M keys */
		keys?: boolean;
		oncompose: (anchor: { time: ReviewTime; area?: ReviewArea }) => void;
		onremove: (id: string) => void;
	}

	let {
		kind,
		value,
		src: given,
		comments,
		pending,
		editable,
		keys = false,
		oncompose,
		onremove,
	}: Props = $props();

	/** the browser does not expose the frame rate, a 30 fps step lands on or beside each frame */
	const FRAME_SECONDS = 1 / 30;
	const SEEK_SECONDS = 5;
	const DRAG_PX = 4;
	const SPEEDS = [0.75, 1, 1.5];

	let src = $derived(given ?? (typeof value === "string" ? imageUrl(value) : undefined));

	let media: HTMLMediaElement | undefined = $state();
	let frame: HTMLElement | undefined = $state();
	let bar: HTMLDivElement | undefined = $state();
	let currentTime = $state(0);
	let duration = $state(0);
	let paused = $state(true);
	let playbackRate = $state(1);
	let loop = $state(false);
	let failed = $state(false);
	let marking = $state(false);

	let ready = $derived(Number.isFinite(duration) && duration > 0);
	let numbers = $derived(pinNumbers(comments));
	let timed = $derived(
		comments.flatMap((comment) => {
			const n = numbers.get(comment.id);
			return comment.time && n ? [{ id: comment.id, n, time: comment.time }] : [];
		})
	);
	let boxes = $derived(
		comments.flatMap((comment) => {
			const n = numbers.get(comment.id);
			return comment.area && n && timeCovers(comment.time, currentTime)
				? [{ id: comment.id, n, area: comment.area }]
				: [];
		})
	);

	let drag = $state<{ from: number; to: number; x: number; moved: boolean } | undefined>(undefined);
	let dragRange = $derived(
		drag?.moved
			? { start: Math.min(drag.from, drag.to), end: Math.max(drag.from, drag.to) }
			: undefined
	);

	const pct = (seconds: number) => (ready ? `${(seconds / duration) * 100}%` : "0%");

	function seekTo(seconds: number) {
		if (!media || !ready) return;
		media.currentTime = Math.min(duration, Math.max(0, seconds));
	}

	function toggle() {
		if (!media || failed) return;
		if (media.paused) void media.play().catch(() => {});
		else media.pause();
	}

	function step(frames: number) {
		media?.pause();
		seekTo(currentTime + frames * FRAME_SECONDS);
	}

	function commentNow() {
		if (!editable) return;
		media?.pause();
		oncompose({ time: { start: timeAt(currentTime) } });
	}

	function startMark() {
		if (!editable) return;
		media?.pause();
		marking = true;
	}

	function goTo(time: ReviewTime) {
		seekTo(time.start);
		if (kind === "audio") void media?.play().catch(() => {});
		else media?.pause();
	}

	const fractionAt = (e: PointerEvent) => {
		const box = bar?.getBoundingClientRect();
		if (!box || box.width === 0) return 0;
		return Math.min(1, Math.max(0, (e.clientX - box.left) / box.width));
	};

	$effect(() => {
		if (!keys) return;
		return claimMediaKeys({
			toggle,
			seek: (direction) => seekTo(currentTime + direction * SEEK_SECONDS),
			step: kind === "video" ? step : undefined,
			comment: editable ? commentNow : undefined,
			mark: kind === "video" && editable ? startMark : undefined,
		});
	});
</script>

{#snippet seekBar(dark: boolean)}
	<div
		bind:this={bar}
		class={["relative flex flex-1 touch-none items-center", kind === "audio" ? "h-14" : "h-[18px]"]}
		role="slider"
		tabindex="0"
		aria-label="Seek"
		aria-valuemin={0}
		aria-valuemax={ready ? Math.round(duration) : 0}
		aria-valuenow={Math.round(currentTime)}
		aria-valuetext={formatClock(currentTime)}
		data-seek-bar
		onkeydown={(e) => {
			if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
				e.preventDefault();
				e.stopPropagation();
				seekTo(currentTime + (e.key === "ArrowLeft" ? -SEEK_SECONDS : SEEK_SECONDS));
			} else if (e.key === "Home" || e.key === "End") {
				e.preventDefault();
				seekTo(e.key === "Home" ? 0 : duration);
			}
		}}
		onpointerdown={(e) => {
			if (!ready || e.button !== 0) return;
			bar?.setPointerCapture(e.pointerId);
			const at = fractionAt(e) * duration;
			drag = { from: at, to: at, x: e.clientX, moved: false };
		}}
		onpointermove={(e) => {
			if (!drag) return;
			drag.to = fractionAt(e) * duration;
			if (Math.abs(e.clientX - drag.x) > DRAG_PX) drag.moved = true;
		}}
		onpointerup={() => {
			if (!drag) return;
			const range = dragRange;
			const from = drag.from;
			drag = undefined;
			if (!range) return seekTo(from);
			seekTo(range.start);
			if (!editable) return;
			media?.pause();
			const start = timeAt(range.start);
			const end = timeAt(range.end);
			oncompose({ time: end > start ? { start, end } : { start } });
		}}
	>
		<div
			class={[
				"absolute inset-x-0 h-1.5 rounded-full",
				dark ? "bg-white/30" : "bg-gray-200 dark:bg-gray-700",
			]}
		></div>
		<div
			class={[
				"absolute left-0 h-1.5 rounded-full",
				dark ? "bg-white" : "bg-gray-900 dark:bg-gray-100",
			]}
			style="width: {pct(currentTime)}"
		></div>
		{#each timed as pin (pin.id)}
			{#if pin.time.end !== undefined}
				<div
					class="absolute h-2.5 rounded-[3px] bg-amber-500/80 dark:bg-amber-400/80"
					style="left: {pct(pin.time.start)}; width: calc({pct(pin.time.end)} - {pct(
						pin.time.start
					)})"
				></div>
			{/if}
			<span
				class={[
					"absolute -ml-[9px] flex size-[18px] items-center justify-center rounded-full bg-amber-500 text-[10px] font-bold text-gray-900 dark:bg-amber-400",
					kind === "audio" ? "top-0" : "-top-5",
				]}
				style="left: {pct(pin.time.start)}"
				data-time-pin={pin.n}
			>
				{pin.n}
			</span>
		{/each}
		{#if dragRange}
			<div
				class="absolute h-2.5 rounded-[3px] bg-blue-500/50"
				style="left: {pct(dragRange.start)}; width: calc({pct(dragRange.end)} - {pct(
					dragRange.start
				)})"
			></div>
		{/if}
		{#if kind === "audio"}
			<div
				class="absolute inset-y-1 w-0.5 -translate-x-1/2 rounded-full bg-blue-600 dark:bg-blue-400"
				style="left: {pct(currentTime)}"
			></div>
		{:else}
			<div
				class="absolute size-3.5 -translate-x-1/2 rounded-full bg-white shadow-[0_1px_4px_rgba(0,0,0,0.4)]"
				style="left: {pct(currentTime)}"
			></div>
		{/if}
	</div>
{/snippet}

{#snippet commentButton()}
	{#if editable}
		<button
			type="button"
			class="inline-flex h-7 items-center gap-1.5 rounded-lg px-2 text-xs font-medium whitespace-nowrap text-gray-500 hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
			onclick={commentNow}
		>
			<CarbonChat class="text-[13px]" />
			Comment at {formatClock(currentTime)}
			<kbd class="font-mono text-[11px] opacity-60">C</kbd>
		</button>
	{/if}
{/snippet}

<div class="flex flex-col gap-3" data-media-stage={kind}>
	{#if !src || failed}
		<span class="font-mono text-xs break-all text-gray-500 dark:text-gray-400">
			{String(value ?? "")}{failed ? " (could not load)" : ""}
		</span>
	{:else if kind === "audio"}
		<section
			aria-label="Audio player"
			class="flex flex-col gap-3 rounded-[14px] border border-gray-200 p-4 dark:border-gray-800"
		>
			<audio
				bind:this={media}
				{src}
				preload="metadata"
				bind:currentTime
				bind:duration
				bind:paused
				bind:playbackRate
				onerror={() => (failed = true)}
			></audio>
			<div class="flex items-center gap-3.5">
				<button
					type="button"
					class="flex size-11 flex-none items-center justify-center rounded-full bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900"
					aria-label={paused ? "Play" : "Pause"}
					onclick={toggle}
				>
					{#if paused}<CarbonPlay />{:else}<CarbonPause />{/if}
				</button>
				{@render seekBar(false)}
			</div>
			<div class="flex flex-wrap items-center gap-2.5 pl-[58px]">
				<span class="font-mono text-[11.5px] font-medium text-gray-900 dark:text-gray-100">
					{formatClock(currentTime, { tenths: true })}
				</span>
				<span class="font-mono text-[11.5px] text-gray-500 dark:text-gray-400">
					/ {formatClock(ready ? duration : 0, { tenths: true })}
				</span>
				<span class="flex-1"></span>
				{@render commentButton()}
				<div
					class="flex rounded-[7px] bg-gray-100 p-0.5 dark:bg-gray-800"
					role="group"
					aria-label="Speed"
				>
					{#each SPEEDS as speed (speed)}
						<button
							type="button"
							class={[
								"h-6 rounded-[5px] px-[7px] font-mono text-[11.5px] font-medium",
								playbackRate === speed
									? "bg-white text-gray-900 dark:bg-gray-900 dark:text-gray-100"
									: "text-gray-500 dark:text-gray-400",
							]}
							aria-pressed={playbackRate === speed}
							onclick={() => (playbackRate = speed)}
						>
							{speed}×
						</button>
					{/each}
				</div>
			</div>
		</section>
	{:else}
		<section
			bind:this={frame}
			aria-label="Video player"
			class="flex flex-col overflow-hidden rounded-xl bg-gray-950"
		>
			<div class="flex justify-center bg-black">
				<div class="relative">
					<!-- svelte-ignore a11y_media_has_caption -->
					<video
						bind:this={media}
						{src}
						preload="metadata"
						playsinline
						{loop}
						class="block max-h-[420px] max-w-full"
						bind:currentTime
						bind:duration
						bind:paused
						onerror={() => (failed = true)}
						onclick={() => !marking && toggle()}
					></video>
					<AreaLayer
						{boxes}
						{pending}
						drawing={marking}
						ondraw={(area) => {
							marking = false;
							oncompose({ time: { start: timeAt(currentTime) }, area });
						}}
						oncancel={() => (marking = false)}
					/>
				</div>
			</div>
			<div class="flex flex-col gap-1.5 px-2.5 pt-6 pb-2">
				{@render seekBar(true)}
				<div class="flex items-center gap-0.5 text-gray-100">
					<button
						type="button"
						class="inline-flex size-8 items-center justify-center rounded-[7px] hover:bg-white/10"
						aria-label={paused ? "Play" : "Pause"}
						onclick={toggle}
					>
						{#if paused}<CarbonPlay />{:else}<CarbonPause />{/if}
					</button>
					<button
						type="button"
						class="inline-flex size-8 items-center justify-center rounded-[7px] hover:bg-white/10"
						aria-label="Previous frame"
						onclick={() => step(-1)}
					>
						<CarbonSkipBack />
					</button>
					<button
						type="button"
						class="inline-flex size-8 items-center justify-center rounded-[7px] hover:bg-white/10"
						aria-label="Next frame"
						onclick={() => step(1)}
					>
						<CarbonSkipForward />
					</button>
					<span class="ml-1.5 font-mono text-[11.5px] font-medium">
						{formatClock(currentTime, { tenths: true })}
					</span>
					<span class="ml-1 font-mono text-[11.5px] text-white/70">
						/ {formatClock(ready ? duration : 0, { tenths: true })}
					</span>
					<span class="flex-1"></span>
					{#if editable}
						<button
							type="button"
							class={[
								"inline-flex h-8 items-center gap-1.5 rounded-[7px] px-2 text-[12.5px] font-medium hover:bg-white/10",
								marking && "bg-white/15",
							]}
							aria-pressed={marking}
							onclick={() => (marking ? (marking = false) : startMark())}
						>
							<CarbonCenterSquare class="text-[15px]" />
							Mark area
							<kbd class="font-mono text-[10px] opacity-60">M</kbd>
						</button>
					{/if}
					<button
						type="button"
						class={[
							"inline-flex size-8 items-center justify-center rounded-[7px] hover:bg-white/10",
							loop && "bg-white/15",
						]}
						aria-label="Loop"
						aria-pressed={loop}
						onclick={() => (loop = !loop)}
					>
						<CarbonRepeat class="text-[15px]" />
					</button>
					<button
						type="button"
						class="inline-flex size-8 items-center justify-center rounded-[7px] hover:bg-white/10"
						aria-label="Full screen"
						onclick={() => void frame?.requestFullscreen?.().catch(() => {})}
					>
						<CarbonMaximize class="text-[15px]" />
					</button>
				</div>
			</div>
		</section>
		{#if editable}
			<div class="-ml-2 flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
				{@render commentButton()}
				<span>· drag on the bar for a range</span>
			</div>
		{/if}
	{/if}
	<AnchoredNotes {comments} {editable} {onremove} onseek={ready ? goTo : undefined} />
</div>
