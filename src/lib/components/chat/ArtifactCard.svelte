<script lang="ts">
	import type { ArtifactOperation, ArtifactKind } from "$lib/utils/artifacts";
	import { artifactOpKey } from "$lib/utils/artifacts";
	import { getArtifactsContext } from "$lib/utils/artifactsContext";

	import CarbonCode from "~icons/carbon/code";
	import CarbonImage from "~icons/carbon/image";
	import CarbonDocument from "~icons/carbon/document";
	import CarbonLogoReact from "~icons/carbon/logo-react";
	import CarbonWarning from "~icons/carbon/warning";
	import LucideAppWindow from "~icons/lucide/app-window";
	import LucideWorkflow from "~icons/lucide/workflow";
	import EosIconsLoading from "~icons/eos-icons/loading";

	interface Props {
		op: ArtifactOperation;
		messageId: string;
		opIndex: number;
	}

	let { op, messageId, opIndex }: Props = $props();

	const ctx = getArtifactsContext();

	let cardRef = $derived(ctx?.registry.byMessageOp.get(artifactOpKey(messageId, opIndex)));
	let artifact = $derived(cardRef ? ctx?.registry.artifacts.get(cardRef.identifier) : undefined);
	let version = $derived(
		cardRef && cardRef.version > 0 ? artifact?.versions[cardRef.version - 1] : undefined
	);

	let missing = $derived(!ctx || !version);
	let streaming = $derived(!!version && !version.complete);
	// Highlight only the card whose version the panel is currently displaying
	let isActive = $derived.by(() => {
		if (!ctx || !version || !artifact) return false;
		if (!ctx.panel.open || ctx.panel.identifier !== version.identifier) return false;
		const displayed = Math.min(
			ctx.panel.version ?? artifact.versions.length,
			artifact.versions.length
		);
		return displayed === version.version;
	});

	const KIND_LABELS: Record<ArtifactKind, string> = {
		html: "Web app",
		react: "React component",
		svg: "SVG image",
		markdown: "Document",
		mermaid: "Diagram",
		code: "Code",
	};

	let title = $derived(
		version?.title ?? (op.kind === "create" ? op.title : (op.title ?? op.identifier))
	);

	let subtitle = $derived.by(() => {
		if (missing) return "This edit couldn't be linked to an artifact";
		if (!version) return "";
		if (streaming) return version.op === "update" ? "Applying edit…" : "Generating…";
		const kindLabel =
			version.type === "code" && version.language
				? `Code · ${version.language}`
				: KIND_LABELS[version.type];
		const versionLabel = (artifact?.versions.length ?? 0) > 1 ? ` · v${version.version}` : "";
		if (version.op === "update") {
			return version.failedPairs
				? `Edited, ${version.failedPairs} change${version.failedPairs > 1 ? "s" : ""} didn't apply${versionLabel}`
				: `Edited${versionLabel}`;
		}
		return `${kindLabel}${versionLabel} · Click to open`;
	});

	function onclick() {
		if (!ctx || !version || !artifact) return;
		// Follow the latest version when this card points at it, so streaming
		// updates keep flowing into the panel; otherwise pin the version.
		const isLatest = version.version === artifact.versions.length;
		ctx.panel.openArtifact(version.identifier, isLatest ? null : version.version);
	}
</script>

<button
	type="button"
	data-exclude-from-copy
	class="my-2 flex w-full max-w-md items-center gap-3 rounded-xl border bg-white px-3.5 py-3 text-left shadow-sm
		{isActive
		? 'border-blue-300 ring-1 ring-blue-300 dark:border-blue-500/30 dark:ring-blue-500/30'
		: 'border-gray-200 hover:border-gray-300 dark:border-gray-700 dark:hover:border-gray-600'}
		{missing ? 'cursor-default opacity-80' : 'cursor-pointer'} dark:bg-gray-800/80"
	onclick={(e) => {
		e.stopPropagation();
		onclick();
	}}
	disabled={missing}
	aria-label="Open artifact: {title}"
>
	<div
		class="flex size-9 flex-none items-center justify-center rounded-lg bg-gray-100 text-gray-500 dark:bg-gray-700/70 dark:text-gray-300"
	>
		{#if streaming}
			<EosIconsLoading class="size-4.5 text-base" />
		{:else if missing}
			<CarbonWarning class="text-base text-amber-500" />
		{:else if version?.type === "html"}
			<LucideAppWindow class="text-base" />
		{:else if version?.type === "react"}
			<CarbonLogoReact class="text-base" />
		{:else if version?.type === "svg"}
			<CarbonImage class="text-base" />
		{:else if version?.type === "markdown"}
			<CarbonDocument class="text-base" />
		{:else if version?.type === "mermaid"}
			<LucideWorkflow class="text-base" />
		{:else}
			<CarbonCode class="text-base" />
		{/if}
	</div>
	<div class="min-w-0 flex-1">
		<p class="truncate text-sm font-medium text-gray-800 dark:text-gray-200">
			{title}
		</p>
		<p class="truncate text-xs text-gray-500 dark:text-gray-400">
			{subtitle}
		</p>
	</div>
</button>
