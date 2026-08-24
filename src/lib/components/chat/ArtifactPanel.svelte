<script lang="ts">
	import { onDestroy, onMount } from "svelte";
	import DOMPurify from "isomorphic-dompurify";

	import type { ArtifactRegistry, ArtifactVersion } from "$lib/utils/artifacts";
	import { artifactFileName, isPreviewableKind } from "$lib/utils/artifacts";
	import { diffLines, diffStats, renderDiffHtml } from "$lib/utils/artifactDiff";
	import {
		buildArtifactSrcdoc,
		capturePreviewError,
		composeFixRequest,
		isDeployableKind,
		normalizePreviewError,
		PREVIEW_ALLOW,
		PREVIEW_SANDBOX,
		type CapturedPreviewError,
	} from "$lib/utils/previewSrcdoc";
	import { captureArtifactScreenshot, pngDataUrlToFile } from "$lib/utils/artifactCapture";
	import { parseExternalUrl } from "$lib/utils/externalLink";
	import { escapeHTML } from "$lib/utils/markedLight";
	import { artifactPanel, ARTIFACT_PANEL_DEFAULT_FRACTION } from "$lib/stores/artifactPanel.svelte";
	import { StickToBottomController } from "$lib/utils/scroll/stickToBottom";
	import { pendingComposerPayload } from "$lib/stores/pendingComposerPayload";
	import { formatScreenshotNotes } from "$lib/utils/screenshotNotes";
	import { error as errorStore } from "$lib/stores/errors";
	import { usePublicConfig } from "$lib/utils/PublicConfig.svelte";
	import { page } from "$app/state";

	import MarkdownRenderer from "./MarkdownRenderer.svelte";
	import CopyToClipBoardBtn from "../CopyToClipBoardBtn.svelte";
	import ExternalLinkModal from "../ExternalLinkModal.svelte";
	import HtmlPreviewModal from "../HtmlPreviewModal.svelte";
	import DeployToSpaceModal from "./DeployToSpaceModal.svelte";
	import ScreenshotAnnotationModal from "./ScreenshotAnnotationModal.svelte";

	import CarbonCloseLarge from "~icons/carbon/close-large";
	import CarbonChevronLeft from "~icons/carbon/chevron-left";
	import CarbonChevronRight from "~icons/carbon/chevron-right";
	import CarbonCamera from "~icons/carbon/camera";
	import CarbonDownload from "~icons/carbon/download";
	import CarbonRocket from "~icons/carbon/rocket";
	import CarbonMaximize from "~icons/carbon/maximize";
	import LucideWrapText from "~icons/lucide/wrap-text";
	import LucideDiff from "~icons/lucide/diff";
	import EosIconsLoading from "~icons/eos-icons/loading";

	interface Props {
		registry: ArtifactRegistry;
		loading?: boolean;
		/** Whether the current model accepts image attachments (enables screenshot-to-chat) */
		canScreenshot?: boolean;
		/**
		 * Sends an ask-to-fix message directly to the chat, returning whether it
		 * was dispatched. Absent when the conversation can't accept messages
		 * (read-only, errored generation), which hides the ask-to-fix controls.
		 */
		onsend?: (text: string) => boolean;
	}

	let { registry, loading = false, canScreenshot = false, onsend }: Props = $props();

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

	// The highlighter lives in the KaTeX/highlight.js chunk, which is kept out
	// of the entry bundle (see markedLight.ts). Load it the first time the
	// panel opens; until it resolves, code renders as escaped plain text and
	// the effect below re-runs automatically once the real highlighter lands.
	let highlightCode: ((text: string, lang?: string) => string) | undefined = $state();
	$effect(() => {
		if (!artifactPanel.open || highlightCode) return;
		import("$lib/utils/marked")
			.then((markedModule) => {
				highlightCode = markedModule.highlightCode;
			})
			.catch(() => {
				// Chunk failed to load (offline, deploy rotation): keep escaped text
				// permanently rather than retrying on every effect re-run.
				highlightCode = (text: string) => escapeHTML(text);
			});
	});

	$effect(() => {
		if (!artifactPanel.open) return;
		const highlight = highlightCode ?? ((text: string) => escapeHTML(text));
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
			highlightedCode = DOMPurify.sanitize(renderDiffHtml(diff, (text) => highlight(text, lang)));
			lastHighlightAt = Date.now();
			return;
		}
		const content = version.content;
		const lang = hljsLanguageFor(version);
		const complete = version.complete;

		const run = () => {
			highlightedCode = DOMPurify.sanitize(highlight(content, lang));
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

	// ----- scroll anchoring -----
	// The scroll containers are reused across artifact/version switches and
	// across streaming, so without explicit anchoring the previous view's
	// position leaks into the next one (e.g. a version that streamed pinned to
	// the bottom leaves the next view opened at the bottom). Every distinct
	// view gets a deterministic anchor instead: streaming pins to the bottom,
	// diffs land on their first change, everything else starts at the top.

	// While streaming, the code view stays pinned to the bottom through a
	// StickToBottomController (growth follows are snaps — code arrives in
	// chunky highlight repaints, where a glide adds motion without
	// information). The controller owns detach/re-attach, so a user scrolling
	// up to read earlier output is never fought mid-gesture, re-attaching
	// catches up immediately, and content reflows (word-wrap toggle, panel
	// resize) re-pin only while actually following.
	let codeStick: StickToBottomController | null = null;
	$effect(() => {
		const el = codeScrollEl;
		if (!el) return;
		const controller = new StickToBottomController(el, {
			// The <code> child (kept block-level in the template so the size
			// observer actually fires) is what grows with streamed content —
			// the <pre> itself is h-full and never resizes.
			content: () => (el.firstElementChild as HTMLElement | null) ?? undefined,
		});
		// The anchor effect below decides each view's initial position; nothing
		// follows until a streaming view pins explicitly.
		controller.unpin();
		codeStick = controller;
		return () => {
			controller.destroy();
			if (codeStick === controller) codeStick = null;
		};
	});

	/** Scroll the code view so the first changed diff line is in view */
	function scrollToFirstChange(el: HTMLElement): boolean {
		const first = el.querySelector(".diff-line");
		if (!first) return false;
		const offset =
			first.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop;
		// Leave ~a quarter viewport of context above the change
		codeStick?.scrollTo(Math.max(0, offset - el.clientHeight / 4));
		return true;
	}

	// Anchor whenever the displayed view actually changes. The key is built
	// from stable primitives (not the version/diff objects, whose references
	// churn with every registry rebuild while other messages stream), plus the
	// container element itself since tab switches recreate it. `revealNonce`
	// bumps on every card click, so re-opening the same view also re-anchors.
	let codeAnchor: { key: string; el: HTMLElement } | undefined;
	$effect(() => {
		// Re-run once the rendered HTML is in sync so the anchor measures the
		// content it's anchoring
		void highlightedCode;
		const el = codeScrollEl;
		if (!el || effectiveTab !== "code" || !version) return;
		const key = `${artifactPanel.identifier}:${version.version}:${showingDiff ? "diff" : "full"}:${artifactPanel.revealNonce}`;
		if (codeAnchor && codeAnchor.key === key && codeAnchor.el === el) return;
		codeAnchor = { key, el };
		const streaming = isStreamingVersion;
		const diffed = showingDiff;
		// rAF: this effect can run in the same flush that set highlightedCode,
		// before {@html} has patched the DOM — measure after the next paint.
		// Not cancelled on re-run: re-runs for the same view return early above,
		// and a frame later the latest-scheduled anchor wins anyway.
		requestAnimationFrame(() => {
			if (!el.isConnected) return;
			if (streaming) {
				codeStick?.jumpToBottom();
				return;
			}
			if (diffed && scrollToFirstChange(el)) return;
			codeStick?.scrollTo(0);
		});
	});

	// The markdown preview reuses its scroll container across versions too;
	// start each version at the top.
	let previewScrollEl: HTMLElement | undefined = $state();
	let previewAnchor: { key: string; el: HTMLElement } | undefined;
	$effect(() => {
		const el = previewScrollEl;
		if (!el || !version) return;
		const key = `${artifactPanel.identifier}:${version.version}:${artifactPanel.revealNonce}`;
		if (previewAnchor && previewAnchor.key === key && previewAnchor.el === el) return;
		previewAnchor = { key, el };
		el.scrollTop = 0;
	});

	onDestroy(() => clearTimeout(highlightTimer));

	// ----- live preview -----
	const previewChannel = `artifact_${Math.random().toString(36).slice(2)}`;
	let iframeEl: HTMLIFrameElement | undefined = $state();
	let errors: CapturedPreviewError[] = $state([]);
	let externalLinkUrl = $state<URL | null>(null);

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

	// True once the iframe finished loading the current srcdoc. srcdoc
	// navigation is asynchronous, so right after a version switch the old
	// document still occupies the frame (and still answers on the shared
	// channel); capture stays disabled until the load event confirms the
	// displayed document is the one srcdoc describes.
	let previewLoaded = $state(false);
	$effect(() => {
		void srcdoc;
		previewLoaded = false;
	});

	type PreviewMessage = {
		type: string;
		channel: string;
		detail?: { message?: unknown; stack?: unknown; href?: unknown };
	};

	function onWindowMessage(ev: MessageEvent) {
		if (!iframeEl || ev.source !== iframeEl.contentWindow) return;
		const raw = ev.data as unknown;
		if (!raw || typeof raw !== "object") return;
		const data = raw as Partial<PreviewMessage>;
		if (data.channel !== previewChannel) return;
		if (data.type === "chatui.preview.openLink") {
			// Only honor link messages backed by a real user gesture (clicks inside
			// the iframe propagate activation to ancestor frames); artifact scripts
			// must not be able to pop the confirm without one
			if (navigator.userActivation && !navigator.userActivation.isActive) return;
			// The iframe runs untrusted generated code, so re-validate its href here
			externalLinkUrl = parseExternalUrl(data.detail?.href) ?? null;
			return;
		}
		if (data.type !== "chatui.preview.error") return;
		errors = capturePreviewError(errors, normalizePreviewError(data.detail));
	}

	// Sends the fix request as a chat message right away. On mobile the panel
	// is a fullscreen overlay that would hide both the sent message and the
	// streaming reply, so close it on send; the panel auto-reopens when the
	// fixed version starts streaming in (maybeAutoOpen). On desktop the chat is
	// visible next to the panel, which stays open to receive the fix.
	function sendFixRequest(text: string): boolean {
		const sent = onsend?.(text) ?? false;
		if (sent && !isDesktop) artifactPanel.close();
		return sent;
	}

	function askToFixErrors() {
		sendFixRequest(composeFixRequest(errors));
	}

	// ----- screenshot to chat -----
	// Only the live iframe preview can be captured: a non-null srcdoc already
	// implies a complete, previewable, non-markdown version on the preview tab.
	let screenshotSupported = $derived(
		canScreenshot && effectiveTab === "preview" && !!srcdoc && previewLoaded
	);
	let capturing = $state(false);
	let pendingScreenshot = $state<{ dataUrl: string; fileName: string; subject: string } | null>(
		null
	);

	async function screenshotPreview() {
		// pendingScreenshot guard: a capture resolving while the annotation modal
		// is already open would silently swap the image under the user.
		// previewLoaded guard: before the iframe committed the current srcdoc,
		// the previous document would answer the request under the new name.
		if (!iframeEl || capturing || pendingScreenshot || !previewLoaded || !artifact) return;
		capturing = true;
		// Freeze name and subject now: a new version can stream in (or the user
		// can navigate) while the annotation modal is open
		const slug = artifact.identifier.replace(/[^a-zA-Z0-9_-]+/g, "-") || "artifact";
		const fileName = `${slug}-v${displayVersionNumber}-screenshot.png`;
		const subject = `"${version?.title ?? artifact.identifier}" (v${displayVersionNumber})`;
		const requestedSrcdoc = srcdoc;
		try {
			// Transparent documents composite over the iframe's own backing, so
			// passing its computed background keeps the shot true to what the
			// user sees in light and dark mode
			const backing = getComputedStyle(iframeEl).backgroundColor;
			const dataUrl = await captureArtifactScreenshot(iframeEl, previewChannel, backing);
			// The channel survives srcdoc swaps, so a version switch (streaming
			// edit, version nav) mid-capture would answer from the replacement
			// document; a shot of a different document must not be attached
			// under the frozen file name
			if (srcdoc !== requestedSrcdoc) {
				throw new Error("the preview changed during capture");
			}
			pendingScreenshot = { dataUrl, fileName, subject };
		} catch (err) {
			errorStore.set(
				`Screenshot failed: ${err instanceof Error ? err.message : "unexpected error"}`
			);
		} finally {
			capturing = false;
		}
	}

	function attachScreenshot(annotatedDataUrl: string, notes: string[]) {
		const shot = pendingScreenshot;
		if (!shot) return;
		pendingComposerPayload.set({
			files: [pngDataUrlToFile(annotatedDataUrl, shot.fileName)],
			// Numbered to match the badges baked into the image; the subject header
			// keeps blocks apart when several annotated screenshots share a draft
			text: formatScreenshotNotes(notes, shot.subject),
		});
		pendingScreenshot = null;
		// On mobile the panel overlays the chat; close it so the attachment is visible
		if (!isDesktop) artifactPanel.close();
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

	// ----- deploy to a Hugging Face Space (HuggingChat only) -----
	const publicConfig = usePublicConfig();
	let conversationId = $derived(page.params?.id);
	let deployModalOpen = $state(false);
	// Deployments made this session, overlaid on the ones loaded with the page so
	// the button flips to "Update" right after a successful first deploy. Keyed by
	// conversation id first: ArtifactPanel is not remounted when only the route
	// param changes, so a flat map would let a stale entry from one conversation
	// mask another conversation's artifact that happens to share an identifier
	// (e.g. the "untitled-artifact" fallback).
	let sessionDeployments = $state<Record<string, Record<string, { repoId: string; url: string }>>>(
		{}
	);
	let loadedDeployments = $derived(
		(page.data as { deployedSpaces?: Record<string, { repoId: string }> })?.deployedSpaces ?? {}
	);
	let currentDeployment = $derived.by(() => {
		const id = artifact?.identifier;
		if (!id) return undefined;
		const session = conversationId ? sessionDeployments[conversationId]?.[id] : undefined;
		if (session) return session;
		const loaded = loadedDeployments[id];
		return loaded
			? { repoId: loaded.repoId, url: `https://huggingface.co/spaces/${loaded.repoId}` }
			: undefined;
	});
	function recordDeployment(deployment: { repoId: string; url: string }) {
		const cid = conversationId;
		const id = artifact?.identifier;
		if (!cid || !id) return;
		sessionDeployments[cid] = { ...(sessionDeployments[cid] ?? {}), [id]: deployment };
	}
	let canDeploy = $derived(
		publicConfig.isHuggingChat &&
			!!conversationId &&
			!!version &&
			version.complete &&
			isDeployableKind(version.type)
	);

	function handleKeydown(e: KeyboardEvent) {
		// An Escape already consumed by a modal (external-link confirm, fullscreen
		// preview) must not also close the panel
		if (e.defaultPrevented) return;
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
	const tabActive = "bg-white text-gray-800 shadow-xs dark:bg-gray-600 dark:text-gray-100";
	const tabInactive =
		"text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200";
	const codeFloatBtn =
		"btn rounded-md border border-gray-200/80 bg-white/90 p-1.5 text-xs backdrop-blur-xs hover:bg-gray-100 hover:text-gray-600 dark:border-gray-700/80 dark:bg-gray-900/90 dark:hover:bg-gray-800 dark:hover:text-gray-300";
</script>

<svelte:window onmessage={onWindowMessage} onkeydown={handleKeydown} />

{#snippet panelContent()}
	<!-- header (z-10 so button tooltips aren't painted over by the body) -->
	<header
		class="@container relative z-10 flex h-12 flex-none items-center gap-2 border-b border-gray-100 px-3 dark:border-gray-800"
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
					class="flex-none rounded-sm bg-gray-100 px-1 py-px font-mono text-xxs text-gray-500 dark:bg-gray-800 dark:text-gray-400"
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

		<div class="flex flex-none items-center gap-0.5 text-gray-500 dark:text-gray-400">
			{#if version}
				<!-- Deploy leads the cluster: it's the promoted action and the only
				     labeled control here, so keeping it next to the tab switcher leaves
				     the trailing icons as one uniform icon-only group.
				     The label rides a container query on the header, not the viewport:
				     the panel is user-resizable, so only its own width says whether
				     there's room for it beside the title. Below the threshold it
				     collapses back to the bare rocket. -->
				{#if canDeploy}
					<button
						type="button"
						class="btn gap-1 rounded-md p-1.5 text-xs hover:bg-gray-100 hover:text-gray-600 @min-[580px]:pr-2 dark:hover:bg-gray-800 dark:hover:text-gray-300"
						title={currentDeployment ? "Update Space" : "Deploy to Space"}
						onclick={() => (deployModalOpen = true)}
					>
						<CarbonRocket />
						<span class="hidden font-medium @min-[580px]:inline">
							{currentDeployment ? "Update" : "Deploy"}
						</span>
					</button>
				{/if}
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
				class="ml-0.5 btn rounded-md p-1 text-base hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
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
				<div bind:this={previewScrollEl} class="scrollbar-custom h-full overflow-y-auto px-6 py-5">
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
					sandbox={PREVIEW_SANDBOX}
					allow={PREVIEW_ALLOW}
					allowfullscreen
					referrerpolicy="no-referrer"
					onload={() => (previewLoaded = true)}
					{srcdoc}
				></iframe>
			{/if}
		{:else}
			<!-- Same .prose pre styling as chat code blocks so the syntax theme matches
			     exactly in both modes; text-smd matches the chat prose root so the code
			     renders at the same size; border-0! since the panel provides its own frame -->
			<div
				class="prose h-full max-w-none text-smd dark:prose-invert prose-pre:my-0 prose-pre:h-full prose-pre:rounded-none"
			>
				<!-- eslint-disable svelte/no-at-html-tags -->
				<!-- The code element MUST be block-level: the scroll controller's
				     ResizeObserver watches it, and observers never fire for
				     non-replaced inline elements — with the default inline display
				     the streaming follow silently dies after the first pin. -->
				<pre
					bind:this={codeScrollEl}
					class="scrollbar-custom h-full overflow-auto border-0! px-5 py-4 font-mono {artifactPanel.codeWrap
						? 'wrap-break-word whitespace-pre-wrap'
						: ''} {showingDiff ? 'diff-view' : ''}"><code class="block"
						>{@html highlightedCode}</code
					></pre>
			</div>
			<!-- Floating so toggling them on/off never reflows the header tab switcher -->
			<div class="absolute top-2 right-3 z-10 flex items-center gap-1">
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
					class="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-linear-to-t from-white/90 to-transparent dark:from-gray-900/90"
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
					class="btn rounded-sm p-1 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-gray-800"
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
					class="btn rounded-sm p-1 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-gray-800"
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
			{:else if errors.length > 0 && onsend}
				<button
					type="button"
					class="btn flex items-center gap-1.5 rounded-full border border-red-300/60 bg-red-50 px-2.5 py-0.5 text-red-600 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-400 dark:hover:bg-red-500/20"
					title={loading
						? "Wait for the current response to finish"
						: "Send the errors and ask for a fix"}
					disabled={loading}
					onclick={askToFixErrors}
				>
					{errors.length} error{errors.length > 1 ? "s" : ""} — ask to fix
				</button>
			{:else if version?.failedPairs}
				<span class="truncate text-amber-600 dark:text-amber-500">
					{version.failedPairs} edit{version.failedPairs > 1 ? "s" : ""} didn't apply
				</span>
			{:else if stats && effectiveTab === "code" && stats.added + stats.removed > 0}
				<button
					type="button"
					class="btn rounded-sm px-1.5 py-0.5 whitespace-nowrap tabular-nums hover:bg-gray-100 dark:hover:bg-gray-800"
					title="Jump to first change"
					onclick={() => codeScrollEl && scrollToFirstChange(codeScrollEl)}
				>
					<span class="text-green-600 dark:text-green-500">+{stats.added}</span>
					<span class="ml-0.5 text-red-600 dark:text-red-500">−{stats.removed}</span>
				</button>
			{/if}
			{#if !isStreamingVersion && screenshotSupported}
				<!-- Rightmost footer action, labeled with a plain word: the header
				     camera icon alone wasn't discoverable enough for the
				     screenshot-and-annotate feedback loop -->
				<button
					type="button"
					class="btn flex-none gap-1.5 rounded-md border border-gray-200/80 bg-white/90 px-2 py-0.5 font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700/80 dark:bg-gray-900/90 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-gray-200"
					title="Screenshot the preview, annotate it, and attach it to the chat"
					disabled={capturing}
					onclick={screenshotPreview}
				>
					{#if capturing}
						<EosIconsLoading class="text-xs" />
					{:else}
						<CarbonCamera class="text-xs" />
					{/if}
					Annotate
				</button>
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
	<!-- The modal can't render a disabled state for its floating error button,
	     so streaming gates the handler entirely -->
	<HtmlPreviewModal
		html={version.content}
		kind={version.type}
		onclose={() => (fullscreenOpen = false)}
		onsend={onsend && !loading ? sendFixRequest : undefined}
	/>
{/if}

{#if externalLinkUrl}
	<ExternalLinkModal url={externalLinkUrl} onclose={() => (externalLinkUrl = null)} />
{/if}

{#if pendingScreenshot}
	<ScreenshotAnnotationModal
		dataUrl={pendingScreenshot.dataUrl}
		onconfirm={attachScreenshot}
		onclose={() => (pendingScreenshot = null)}
	/>
{/if}

{#if deployModalOpen && version && artifact && conversationId}
	<DeployToSpaceModal
		{conversationId}
		artifactIdentifier={artifact.identifier}
		title={version.title}
		kind={version.type}
		content={version.content}
		existing={currentDeployment}
		onclose={() => (deployModalOpen = false)}
		ondeployed={recordDeployment}
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
