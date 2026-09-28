<script lang="ts">
	import { untrack } from "svelte";
	import DOMPurify from "isomorphic-dompurify";
	import { mlRegistry } from "$lib/stores/mlRegistry.svelte";
	import { diffLines, diffStats, renderDiffHtml } from "$lib/utils/artifactDiff";
	import { escapeHTML } from "$lib/utils/markedLight";
	import { fileLanguage } from "$lib/utils/mlRegistry";

	interface Props {
		name: string;
		version: number;
	}

	let { name, version }: Props = $props();

	let current = $derived(mlRegistry.fileContent(name, version));
	let previous = $derived(version > 1 ? mlRegistry.fileContent(name, version - 1) : undefined);
	let wholeFile = $state(false);
	let codeEl: HTMLElement | undefined = $state();

	function load() {
		void mlRegistry.loadFileContent(name, version);
		if (version > 1) void mlRegistry.loadFileContent(name, version - 1);
	}

	$effect(() => {
		void name;
		void version;
		untrack(load);
	});

	let failed = $derived(current?.status === "error" || previous?.status === "error");
	let ready = $derived(
		current?.status === "ready" && (version === 1 || previous?.status === "ready")
	);
	let diff = $derived(
		current?.status === "ready" && previous?.status === "ready"
			? diffLines(previous.value, current.value)
			: undefined
	);
	let stats = $derived(diff ? diffStats(diff) : undefined);
	let showingDiff = $derived(!!diff && !wholeFile);

	// lazy so the highlighter chunk stays out of the entry bundle
	let highlightCode = $state<(text: string, lang?: string) => string>();
	$effect(() => {
		if (highlightCode) return;
		import("$lib/utils/marked")
			.then((markedModule) => (highlightCode = markedModule.highlightCode))
			.catch(() => (highlightCode = (text: string) => escapeHTML(text)));
	});

	let html = $derived.by(() => {
		if (current?.status !== "ready") return "";
		const lang = fileLanguage(name);
		const highlight = highlightCode ?? ((text: string) => escapeHTML(text));
		if (showingDiff && diff) {
			return DOMPurify.sanitize(renderDiffHtml(diff, (text) => highlight(text, lang)));
		}
		return DOMPurify.sanitize(highlight(current.value, lang));
	});

	// scroll by whole lines so the top line is never cut in half
	$effect(() => {
		void html;
		if (!codeEl) return;
		const first = showingDiff ? codeEl.querySelector<HTMLElement>(".diff-line") : null;
		if (!first) {
			codeEl.scrollTop = 0;
			return;
		}
		const lineHeight = parseFloat(getComputedStyle(codeEl).lineHeight);
		const top =
			first.getBoundingClientRect().top -
			codeEl.getBoundingClientRect().top -
			codeEl.clientTop +
			codeEl.scrollTop;
		codeEl.scrollTop = Math.max(0, top - 3 * lineHeight);
	});
</script>

<div class="ml-file-view mt-1.5 mb-1">
	{#if failed}
		<p class="ml-file-view-note">
			Could not load v{version}.
			<button type="button" class="ml-file-view-retry" onclick={load}>Try again</button>
		</p>
	{:else if !ready}
		<p class="ml-file-view-note" role="status">Loading v{version}…</p>
	{:else}
		<div class="ml-file-view-bar flex flex-wrap items-center gap-x-2 gap-y-1 pb-1.5 text-xs">
			{#if diff && stats}
				<span class="font-mono">v{version - 1} → v{version}</span>
				<span class="ml-file-view-stats font-mono tabular-nums">
					<span class="ml-diff-added">+{stats.added}</span>
					<span class="ml-diff-removed">−{stats.removed}</span>
				</span>
				<span class="ml-file-view-toggle ml-auto" role="group" aria-label="Show">
					<button type="button" aria-pressed={!wholeFile} onclick={() => (wholeFile = false)}>
						Changes
					</button>
					<button type="button" aria-pressed={wholeFile} onclick={() => (wholeFile = true)}>
						Whole file
					</button>
				</span>
			{:else}
				<span>The first version, in full</span>
			{/if}
		</div>
		<!-- eslint-disable svelte/no-at-html-tags -->
		<pre
			bind:this={codeEl}
			class="ml-file-code scrollbar-custom font-mono {showingDiff ? 'diff-view' : ''}"><code
				class="block">{@html html}</code
			></pre>
	{/if}
</div>

<style>
	.ml-file-view-note {
		padding: 4px 0;
		font-size: 12px;
		color: #a8a29e;
	}

	:global(.dark) .ml-file-view-note {
		color: #78716c;
	}

	.ml-file-view-retry {
		margin-left: 4px;
		text-decoration: underline;
		text-underline-offset: 2px;
		color: #57534e;
	}

	:global(.dark) .ml-file-view-retry {
		color: #d6d3d1;
	}

	.ml-file-view-bar {
		color: #78716c;
	}

	:global(.dark) .ml-file-view-bar {
		color: #a8a29e;
	}

	.ml-diff-added {
		color: #50a14f;
	}

	.ml-diff-removed {
		margin-left: 2px;
		color: #e45649;
	}

	:global(.dark) .ml-diff-added {
		color: #98c379;
	}

	:global(.dark) .ml-diff-removed {
		color: #e06c75;
	}

	.ml-file-view-toggle {
		display: inline-flex;
		padding: 2px;
		border-radius: 6px;
		background: rgba(0, 0, 0, 0.05);
	}

	:global(.dark) .ml-file-view-toggle {
		background: rgba(255, 255, 255, 0.07);
	}

	.ml-file-view-toggle button {
		padding: 1px 8px;
		border-radius: 4px;
		font-size: 11px;
		font-weight: 500;
		color: #78716c;
	}

	.ml-file-view-toggle button[aria-pressed="true"] {
		background: #fff;
		color: #1c1917;
		box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
	}

	:global(.dark) .ml-file-view-toggle button {
		color: #a8a29e;
	}

	:global(.dark) .ml-file-view-toggle button[aria-pressed="true"] {
		background: #292524;
		color: #f5f5f4;
		box-shadow: none;
	}

	.ml-file-code {
		max-height: 24rem;
		overflow: auto;
		margin: 0;
		padding: 8px 10px;
		border: 1px solid #ececea;
		border-radius: 6px;
		background: #fafaf9;
		font-size: 12px;
		line-height: 1.55;
		color: #383a42;
		white-space: pre;
	}

	:global(.dark) .ml-file-code {
		border-color: #262626;
		background: #171717;
		color: #abb2bf;
	}

	/* background tints only so token colours survive */
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
