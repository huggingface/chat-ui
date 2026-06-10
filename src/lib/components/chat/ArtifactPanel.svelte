<script lang="ts">
	import { onDestroy, onMount } from "svelte";
	import DOMPurify from "isomorphic-dompurify";

	import type { ArtifactRegistry, ArtifactVersion } from "$lib/utils/artifacts";
	import { artifactFileName, isPreviewableKind } from "$lib/utils/artifacts";
	import { diffLines, diffStats, renderDiffHtml } from "$lib/utils/artifactDiff";
	import { buildArtifactSrcdoc } from "$lib/utils/previewSrcdoc";
	import { highlightCode } from "$lib/utils/marked";
	import { artifactPanel, ARTIFACT_PANEL_DEFAULT_FRACTION } from "$lib/stores/artifactPanel.svelte";
	import { pendingChatInput } from "$lib/stores/pendingChatInput";

	import MarkdownRenderer from "./MarkdownRenderer.svelte";
	import CopyToClipBoardBtn from "../CopyToClipBoardBtn.svelte";
	import HtmlPreviewModal from "../HtmlPreviewModal.svelte";

	import CarbonCloseLarge from "~icons/carbon/close-large";
	import CarbonChevronLeft from "~icons/carbon/chevron-left";
	import CarbonChevronRight from "~icons/carbon/chevron-right";
	import CarbonDownload from "~icons/carbon/download";
	import CarbonMaximize from "~icons/carbon/maximize";
	import LucideWrapText from "~icons/lucide/wrap-text";
	import LucideDiff from "~icons/lucide/diff";
	import EosIconsLoading from "~icons/eos-icons/loading";

	interface Props {
		registry: ArtifactRegistry;
		loading?: boolean;
	}

	let { registry, loading = false }: Props = $props();

	let artifact = $derived(
		artifactPanel.identifier ? registry.artifacts.get(artifactPanel.identifier) : undefined
	);
	let totalVersions = $derived(artifact?.versions.length ?? 0);
	let displayVersionNumber = $derived(
		artifactPanel.version === null ? totalVersions : Math.min(artifactPanel.version, totalVersions)
	);
	let version = $derived<ArtifactVersion | undefined>(
		artifact && displayVersionNumber > 0 ? artifact.versions[displayVersionNumber - 1] : undefined
	);
	let isStreamingVersion = $derived(!!version && !version.complete);
	let previewable = $derived(!!version && isPreviewableKind(version.type));
	let effectiveTab = $derived<"preview" | "code">(
		!previewable || isStreamingVersion ? "code" : artifactPanel.tab
	);

	// ----- diff view for edit versions -----
	// Only `update` ops get a diff: they edit the previous version in place, so
	// the line diff is small and meaningful. Rewrites re-emit everything and
	// would mostly produce a wall of removed+added lines.
	let prevVersion = $derived(
		artifact && version && version.version > 1 ? artifact.versions[version.version - 2] : undefined
	);
	let canDiff = $derived(!!version?.complete && version?.op === "update" && !!prevVersion);
	let showingDiff = $derived(canDiff && artifactPanel.diffView);
	let diff = $derived(
		showingDiff && version && prevVersion
			? diffLines(prevVersion.content, version.content)
			: undefined
	);
	let stats = $derived(diff ? diffStats(diff) : undefined);

	// Close the panel if its artifact disappeared (e.g. branch switch, message
	// edit). Debounced: the registry can have transient gaps while a finished
	// generation is invalidated/refetched, and those must not close the panel.
	$effect(() => {
		if (artifactPanel.open && artifactPanel.identifier && !artifact) {
			const timer = setTimeout(() => artifactPanel.close(), 300);
			return () => clearTimeout(timer);
		}
	});

	// ----- responsive container -----
	let isDesktop = $state(true);
	onMount(() => {
		const mq = window.matchMedia("(min-width: 768px)");
		isDesktop = mq.matches;
		const onChange = () => (isDesktop = mq.matches);
		mq.addEventListener("change", onChange);
		return () => mq.removeEventListener("change", onChange);
	});

	// ----- code view: throttled highlighting while streaming -----
	let highlightedCode = $state("");
	let lastHighlightAt = 0;
	let highlightTimer: ReturnType<typeof setTimeout> | undefined;
	let codeScrollEl: HTMLElement | undefined = $state();

	function hljsLanguageFor(v: ArtifactVersion): string | undefined {
		switch (v.type) {
			case "code":
				return v.language;
			case "html":
				return "html";
			case "svg":
				return "xml";
			case "markdown":
				return "markdown";
			case "react":
				return "typescript";
			case "mermaid":
				return undefined;
		}
	}

	$effect(() => {
		if (!artifactPanel.open) return;
		// A pending throttled run would paint stale content over whatever the
		// branches below decide to show
		clearTimeout(highlightTimer);
		if (!version) {
			// Don't hold the previous artifact's code while the new target has no
			// version yet (e.g. its opening tag just streamed in)
			highlightedCode = "";
			return;
		}
		if (diff) {
			// Diff view only exists for complete versions, so no throttling needed.
			// The highlighter runs on the full old/new contents so token colors
			// survive in the diff (multi-line constructs included).
			const lang = hljsLanguageFor(version);
			highlightedCode = DOMPurify.sanitize(
				renderDiffHtml(diff, (text) => highlightCode(text, lang))
			);
			lastHighlightAt = Date.now();
			return;
		}
		const content = version.content;
		const lang = hljsLanguageFor(version);
		const complete = version.complete;

		const run = () => {
			highlightedCode = DOMPurify.sanitize(highlightCode(content, lang));
			lastHighlightAt = Date.now();
		};

		if (complete) {
			run();
			return;
		}
		// While streaming, re-highlight at most ~6 times per second
		const elapsed = Date.now() - lastHighlightAt;
		if (elapsed >= 150) run();
		else highlightTimer = setTimeout(run, 150 - elapsed);
	});

	// Keep the code view pinned to the bottom while content streams in
	$effect(() => {
		void highlightedCode;
		if (codeScrollEl && isStreamingVersion && effectiveTab === "code") {
			codeScrollEl.scrollTop = codeScrollEl.scrollHeight;
		}
	});

	// When a diff is shown, jump to the first changed line so the edit is
	// visible without hunting for it. Keyed on the rendered HTML string (not
	// the diff array, whose reference churns with every registry rebuild while
	// other messages stream), so it only re-runs when the view really changes.
	$effect(() => {
		void highlightedCode;
		if (!showingDiff || !codeScrollEl) return;
		const el = codeScrollEl;
		// rAF: when the panel mounts straight into the code tab, this effect can
		// run in the same flush that sets highlightedCode, before {@html} has
		// patched the DOM — after the next paint the diff lines are queryable
		const raf = requestAnimationFrame(() => {
			const first = el.querySelector(".diff-line");
			if (!first) return;
			const offset =
				first.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop;
			// Leave ~a quarter viewport of context above the change
			el.scrollTop = offset - el.clientHeight / 4;
		});
		return () => cancelAnimationFrame(raf);
	});

	onDestroy(() => clearTimeout(highlightTimer));

	// ----- live preview -----
	const previewChannel = `artifact_${Math.random().toString(36).slice(2)}`;
	let iframeEl: HTMLIFrameElement | undefined = $state();
	let errors: { message: string; stack?: string }[] = $state([]);

	let srcdoc = $derived.by(() => {
		if (!version || !version.complete) return undefined;
		if (version.type === "markdown" || version.type === "code") return undefined;
		return buildArtifactSrcdoc(version.type, version.content, previewChannel);
	});

	// Reset captured errors whenever the previewed document changes
	$effect(() => {
		void srcdoc;
		errors = [];
	});

	type PreviewMessage = {
		type: string;
		channel: string;
		detail?: { message?: unknown; stack?: string };
	};

	function onWindowMessage(ev: MessageEvent) {
		if (!iframeEl || ev.source !== iframeEl.contentWindow) return;
		const raw = ev.data as unknown;
		if (!raw || typeof raw !== "object") return;
		const data = raw as Partial<PreviewMessage>;
		if (data.type !== "chatui.preview.error" || data.channel !== previewChannel) return;
		const detail = (data.detail ?? {}) as { message?: unknown; stack?: string };
		errors = [...errors, { message: String(detail.message ?? "Error"), stack: detail.stack }];
	}

	function askToFixErrors() {
		const lines = errors.map((e, i) => `${i + 1}. ${e.message}${e.stack ? `\n${e.stack}` : ""}`);
		const summary = lines[0] ?? "Unknown error";
		pendingChatInput.set(
			errors.length > 1
				? `it's not working: ${summary} (+${errors.length - 1} more) - can you fix it?`
				: `it's not working: ${summary} - can you fix it?`
		);
	}

	// ----- actions -----
	let fullscreenOpen = $state(false);
	let fullscreenSupported = $derived(
		!!version && version.complete && version.type !== "markdown" && version.type !== "code"
	);

	function download() {
		if (!version) return;
		const blob = new Blob([version.content], { type: "text/plain;charset=utf-8" });
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = artifactFileName(version);
		document.body.appendChild(a);
		a.click();
		a.remove();
		URL.revokeObjectURL(url);
	}

	function gotoVersion(n: number) {
		if (!artifact) return;
		const clamped = Math.max(1, Math.min(n, totalVersions));
		artifactPanel.version = clamped >= totalVersions ? null : clamped;
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === "Escape" && artifactPanel.open && !fullscreenOpen && !loading) {
			e.preventDefault();
			artifactPanel.close();
		}
	}

	// ----- resize (desktop) -----
	let resizing = $state(false);
	let asideEl: HTMLElement | undefined = $state();
	function onResizeStart(e: PointerEvent) {
		resizing = true;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}
	function onResizeMove(e: PointerEvent) {
		if (!resizing) return;
		// Clamp against the live chat/panel split (each pane keeps >= 20%) so the
		// drag tracks the pointer 1:1 with no dead zone at the bounds.
		const total = asideEl?.parentElement?.clientWidth ?? window.innerWidth;
		const raw = window.innerWidth - e.clientX;
		artifactPanel.setWidth(Math.min(Math.max(raw, Math.max(total * 0.2, 300)), total * 0.8));
	}
	function onResizeEnd() {
		resizing = false;
	}

	const tabBase =
		"rounded-md px-2.5 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40";
	const tabActive = "bg-white text-gray-800 shadow-sm dark:bg-gray-600 dark:text-gray-100";
	const tabInactive =
		"text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200";
	const codeFloatBtn =
		"btn rounded-md border border-gray-200/80 bg-white/90 p-1.5 text-xs backdrop-blur-sm hover:bg-gray-100 hover:text-gray-600 dark:border-gray-700/80 dark:bg-gray-900/90 dark:hover:bg-gray-800 dark:hover:text-gray-300";
</script>

<svelte:window onmessage={onWindowMessage} onkeydown={handleKeydown} />

{#snippet panelContent()}
	<!-- header (z-10 so button tooltips aren't painted over by the body) -->
	<header
		class="relative z-10 flex h-12 flex-none items-center gap-2 border-b border-gray-100 px-3 dark:border-gray-800"
	>
		<div class="flex min-w-0 flex-1 items-center gap-2">
			{#if isStreamingVersion}
				<EosIconsLoading class="flex-none text-sm text-gray-400" />
			{/if}
			<h2 class="truncate text-sm font-semibold text-gray-800 dark:text-gray-200">
				{version?.title ?? artifactPanel.identifier}
			</h2>
			{#if totalVersions > 1}
				<span
					class="flex-none rounded bg-gray-100 px-1 py-px font-mono text-xxs text-gray-500 dark:bg-gray-800 dark:text-gray-400"
				>
					v{displayVersionNumber}
				</span>
			{/if}
		</div>

		<div class="flex flex-none items-center rounded-lg bg-gray-100 p-0.5 dark:bg-gray-800">
			<button
				type="button"
				class="{tabBase} {effectiveTab === 'preview' ? tabActive : tabInactive}"
				disabled={!previewable || isStreamingVersion}
				onclick={() => artifactPanel.selectTab("preview")}
			>
				Preview
			</button>
			<button
				type="button"
				class="{tabBase} {effectiveTab === 'code' ? tabActive : tabInactive}"
				onclick={() => artifactPanel.selectTab("code")}
			>
				Code
			</button>
		</div>

		<div class="flex flex-none items-center gap-0.5 text-gray-400">
			{#if version}
				<CopyToClipBoardBtn
					value={version.content}
					classNames="btn rounded-md p-1.5 text-sm hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300 focus:ring-0"
					iconClassNames="text-xs"
				/>
				<button
					type="button"
					class="btn rounded-md p-1.5 text-xs hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
					title="Download {artifactFileName(version)}"
					onclick={download}
				>
					<CarbonDownload />
				</button>
				{#if fullscreenSupported}
					<button
						type="button"
						class="btn rounded-md p-1.5 text-xs hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
						title="Open fullscreen"
						onclick={() => (fullscreenOpen = true)}
					>
						<CarbonMaximize />
					</button>
				{/if}
			{/if}
			<!-- close-large at text-base: the X glyph fills less of its viewBox than the
			     sibling icons, so it needs the bump to read as the same visual size;
			     p-1 keeps the button footprint identical to its p-1.5 text-xs siblings -->
			<button
				type="button"
				class="btn ml-0.5 rounded-md p-1 text-base hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
				title="Close panel (Esc)"
				onclick={() => artifactPanel.close()}
			>
				<CarbonCloseLarge />
			</button>
		</div>
	</header>

	<!-- body -->
	<div class="relative min-h-0 flex-1 bg-white dark:bg-gray-900">
		{#if !version}
			<div class="flex h-full items-center justify-center text-sm text-gray-400">
				No artifact selected
			</div>
		{:else if effectiveTab === "preview"}
			{#if version.type === "markdown"}
				<div class="scrollbar-custom h-full overflow-y-auto px-6 py-5">
					<div
						class="prose prose-sm max-w-none dark:prose-invert prose-headings:font-semibold prose-pre:bg-gray-800 dark:prose-pre:bg-gray-900"
					>
						<MarkdownRenderer content={version.content} />
					</div>
				</div>
			{:else if srcdoc}
				<!-- Backing matches the panel theme so opening the preview doesn't flash
				     white in dark mode while the document paints its own background -->
				<iframe
					bind:this={iframeEl}
					title="Artifact preview"
					class="h-full w-full bg-white dark:bg-gray-900 {resizing ? 'pointer-events-none' : ''}"
					sandbox="allow-scripts allow-popups allow-forms"
					referrerpolicy="no-referrer"
					{srcdoc}
				></iframe>
			{/if}
		{:else}
			<!-- Same .prose pre styling as chat code blocks so the syntax theme matches
			     exactly in both modes; text-smd matches the chat prose root so the code
			     renders at the same size; !border-0 since the panel provides its own frame -->
			<div
				class="prose h-full max-w-none text-smd dark:prose-invert prose-pre:my-0 prose-pre:h-full prose-pre:rounded-none"
			>
				<!-- eslint-disable svelte/no-at-html-tags -->
				<pre
					bind:this={codeScrollEl}
					class="scrollbar-custom h-full overflow-auto !border-0 px-5 py-4 font-mono {artifactPanel.codeWrap
						? 'whitespace-pre-wrap break-words'
						: ''} {showingDiff ? 'diff-view' : ''}"><code>{@html highlightedCode}</code></pre>
			</div>
			<!-- Floating so toggling them on/off never reflows the header tab switcher -->
			<div class="absolute right-3 top-2 z-10 flex items-center gap-1">
				{#if canDiff}
					<button
						type="button"
						class="{codeFloatBtn} {artifactPanel.diffView
							? 'text-gray-600 dark:text-gray-300'
							: 'text-gray-400'}"
						title={artifactPanel.diffView ? "Show full code" : "Show what changed"}
						aria-pressed={artifactPanel.diffView}
						onclick={() => artifactPanel.toggleDiffView()}
					>
						<LucideDiff />
					</button>
				{/if}
				<button
					type="button"
					class="{codeFloatBtn} {artifactPanel.codeWrap
						? 'text-gray-600 dark:text-gray-300'
						: 'text-gray-400'}"
					title="{artifactPanel.codeWrap ? 'Disable' : 'Enable'} word wrap"
					aria-pressed={artifactPanel.codeWrap}
					onclick={() => artifactPanel.toggleCodeWrap()}
				>
					<LucideWrapText />
				</button>
			</div>
			{#if isStreamingVersion}
				<div
					class="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-white/90 to-transparent dark:from-gray-900/90"
				></div>
			{/if}
		{/if}
	</div>

	<!-- footer -->
	<footer
		class="flex h-10 flex-none items-center justify-between gap-2 border-t border-gray-100 px-3 text-xs text-gray-500 dark:border-gray-800 dark:text-gray-400"
	>
		<div class="flex items-center gap-1">
			{#if totalVersions > 1}
				<button
					type="button"
					class="btn rounded p-1 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-gray-800"
					disabled={displayVersionNumber <= 1}
					title="Previous version"
					onclick={() => gotoVersion(displayVersionNumber - 1)}
				>
					<CarbonChevronLeft />
				</button>
				<span class="whitespace-nowrap tabular-nums">
					{`v${displayVersionNumber} / ${totalVersions}`}
				</span>
				<button
					type="button"
					class="btn rounded p-1 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-gray-800"
					disabled={displayVersionNumber >= totalVersions}
					title="Next version"
					onclick={() => gotoVersion(displayVersionNumber + 1)}
				>
					<CarbonChevronRight />
				</button>
			{:else if version}
				<span class="capitalize">
					{version.type === "code" ? (version.language ?? "code") : version.type}
				</span>
			{/if}
		</div>

		<div class="flex min-w-0 items-center gap-2">
			{#if isStreamingVersion}
				<span class="router-shimmer whitespace-nowrap">
					{version?.op === "update" ? "Applying edit" : "Generating"}
				</span>
			{:else if errors.length > 0}
				<button
					type="button"
					class="btn flex items-center gap-1.5 rounded-full border border-red-300/60 bg-red-50 px-2.5 py-0.5 text-red-600 hover:bg-red-100 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-400 dark:hover:bg-red-500/20"
					title="Send the error to the chat input"
					onclick={askToFixErrors}
				>
					{errors.length} error{errors.length > 1 ? "s" : ""} — ask to fix
				</button>
			{:else if version?.failedPairs}
				<span class="truncate text-amber-600 dark:text-amber-500">
					{version.failedPairs} edit{version.failedPairs > 1 ? "s" : ""} didn't apply
				</span>
			{:else if stats && effectiveTab === "code" && stats.added + stats.removed > 0}
				<span class="whitespace-nowrap tabular-nums">
					<span class="text-green-600 dark:text-green-500">+{stats.added}</span>
					<span class="ml-0.5 text-red-600 dark:text-red-500">−{stats.removed}</span>
				</span>
			{/if}
		</div>
	</footer>
{/snippet}

{#if artifactPanel.open && artifact}
	{#if isDesktop}
		<aside
			bind:this={asideEl}
			class="pointer-events-auto relative z-10 flex h-full flex-none flex-col overflow-hidden border-l border-gray-100 bg-white dark:border-gray-800 dark:bg-gray-900"
			style="width: {artifactPanel.widthPx !== null
				? `${artifactPanel.widthPx}px`
				: ARTIFACT_PANEL_DEFAULT_FRACTION}; min-width: max(20%, 300px); max-width: 80%;"
			aria-label="Artifact panel"
		>
			<!-- resize handle (drag to resize, double-click to reset) -->
			<div
				role="separator"
				aria-orientation="vertical"
				class="absolute inset-y-0 left-0 z-20 w-1.5 cursor-col-resize transition-colors hover:bg-blue-400/40 {resizing
					? 'bg-blue-400/60'
					: ''}"
				onpointerdown={onResizeStart}
				onpointermove={onResizeMove}
				onpointerup={onResizeEnd}
				onpointercancel={onResizeEnd}
				ondblclick={() => artifactPanel.resetWidth()}
			></div>
			{@render panelContent()}
		</aside>
	{:else}
		<div
			class="pointer-events-auto fixed inset-0 z-30 flex flex-col bg-white dark:bg-gray-900"
			role="dialog"
			aria-label="Artifact panel"
		>
			{@render panelContent()}
		</div>
	{/if}
{/if}

{#if fullscreenOpen && version}
	<HtmlPreviewModal
		html={version.content}
		kind={version.type}
		onclose={() => (fullscreenOpen = false)}
	/>
{/if}

<style>
	/* Diff view: background-only tint bands behind changed lines, so the hljs
	   token colors stay intact; the changed segment of a replaced line gets a
	   stronger emphasis chip. Sign colors match the syntax theme greens/reds. */
	pre.diff-view :global(.diff-line) {
		display: inline-block;
		min-width: 100%;
		border-radius: 0.125rem;
	}
	pre.diff-view :global(.diff-add) {
		background: rgba(80, 161, 79, 0.09);
	}
	pre.diff-view :global(.diff-del) {
		background: rgba(228, 86, 73, 0.08);
	}
	pre.diff-view :global(.diff-add > .diff-sign) {
		color: #50a14f;
	}
	pre.diff-view :global(.diff-del > .diff-sign) {
		color: #e45649;
	}
	pre.diff-view :global(.diff-add .diff-emph) {
		background: rgba(80, 161, 79, 0.22);
		border-radius: 0.1875rem;
	}
	pre.diff-view :global(.diff-del .diff-emph) {
		background: rgba(228, 86, 73, 0.2);
		border-radius: 0.1875rem;
	}
	:global(.dark) pre.diff-view :global(.diff-add) {
		background: rgba(152, 195, 121, 0.1);
	}
	:global(.dark) pre.diff-view :global(.diff-del) {
		background: rgba(224, 108, 117, 0.1);
	}
	:global(.dark) pre.diff-view :global(.diff-add > .diff-sign) {
		color: #98c379;
	}
	:global(.dark) pre.diff-view :global(.diff-del > .diff-sign) {
		color: #e06c75;
	}
	:global(.dark) pre.diff-view :global(.diff-add .diff-emph) {
		background: rgba(152, 195, 121, 0.24);
	}
	:global(.dark) pre.diff-view :global(.diff-del .diff-emph) {
		background: rgba(224, 108, 117, 0.24);
	}
</style>
