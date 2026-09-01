<script lang="ts">
	import { MessageToolUpdateType, type MessageToolUpdate } from "$lib/types/MessageUpdate";
	import {
		isMessageToolCallUpdate,
		isMessageToolErrorUpdate,
		isMessageToolProgressUpdate,
		isMessageToolResultUpdate,
	} from "$lib/utils/messageUpdates";
	import { formatToolProgressLabel } from "$lib/utils/toolProgress";
	import { ToolResultStatus, type ToolFront } from "$lib/types/Tool";
	import { page } from "$app/state";
	import CarbonChevronRight from "~icons/carbon/chevron-right";
	import CarbonChartLine from "~icons/carbon/chart-line";
	import LucideTriangleAlert from "~icons/lucide/triangle-alert";
	import BlockWrapper from "./BlockWrapper.svelte";
	import { sidePane } from "$lib/stores/sidePane.svelte";
	import { trackioDashboardsFromToolUpdates } from "$lib/utils/trackio";

	interface Props {
		tool: MessageToolUpdate[];
		loading?: boolean;
	}

	let { tool, loading = false }: Props = $props();

	let isOpen = $state(false);

	let toolFnName = $derived(tool.find(isMessageToolCallUpdate)?.call.name);
	let toolError = $derived(tool.some(isMessageToolErrorUpdate));
	let toolDone = $derived(tool.some(isMessageToolResultUpdate));
	let isExecuting = $derived(!toolDone && !toolError && loading);
	let toolProgress = $derived.by(() => {
		for (let i = tool.length - 1; i >= 0; i -= 1) {
			const update = tool[i];
			if (isMessageToolProgressUpdate(update)) return update;
		}
		return undefined;
	});
	let progressLabel = $derived.by(() => formatToolProgressLabel(toolProgress));

	// A training run that syncs to Trackio prints its dashboard URL into the job
	// output, so the tool group that ran it is also the natural place to get back
	// to the dashboard after closing the pane.
	let dashboards = $derived(trackioDashboardsFromToolUpdates(tool));
	let openDashboardUrl = $derived(
		sidePane.open && sidePane.view === "trackio" ? sidePane.trackio?.url : undefined
	);

	const availableTools: ToolFront[] = $derived.by(
		() => (page.data as { tools?: ToolFront[] } | undefined)?.tools ?? []
	);

	type ToolOutput = Record<string, unknown>;
	type McpImageContent = {
		type: "image";
		data: string;
		mimeType: string;
	};

	const formatValue = (value: unknown): string => {
		if (value == null) return "";
		if (typeof value === "object") {
			try {
				return JSON.stringify(value, null, 2);
			} catch {
				return String(value);
			}
		}
		return String(value);
	};

	const getOutputText = (output: ToolOutput): string | undefined => {
		const maybeText = output["text"];
		if (typeof maybeText !== "string") return undefined;
		return maybeText;
	};

	const isImageBlock = (value: unknown): value is McpImageContent => {
		if (typeof value !== "object" || value === null) return false;
		const obj = value as Record<string, unknown>;
		return (
			obj["type"] === "image" &&
			typeof obj["data"] === "string" &&
			typeof obj["mimeType"] === "string"
		);
	};

	const getImageBlocks = (output: ToolOutput): McpImageContent[] => {
		const blocks = output["content"];
		if (!Array.isArray(blocks)) return [];
		return blocks.filter(isImageBlock);
	};

	const getMetadataEntries = (output: ToolOutput): Array<[string, unknown]> => {
		return Object.entries(output).filter(
			([key, value]) => value != null && key !== "content" && key !== "text"
		);
	};

	interface ParsedToolOutput {
		text?: string;
		images: McpImageContent[];
		metadata: Array<[string, unknown]>;
	}

	const parseToolOutputs = (outputs: ToolOutput[]): ParsedToolOutput[] =>
		outputs.map((output) => ({
			text: getOutputText(output),
			images: getImageBlocks(output),
			metadata: getMetadataEntries(output),
		}));
</script>

{#if toolFnName}
	<BlockWrapper>
		<!-- Header row -->
		<div class="flex max-w-full flex-col items-start gap-1 select-none">
			<button
				type="button"
				class="group/header flex max-w-full cursor-pointer items-center gap-1 text-left whitespace-nowrap focus:outline-hidden"
				onclick={() => (isOpen = !isOpen)}
				aria-label={isOpen ? "Collapse" : "Expand"}
			>
				<!-- Errors here are often recoverable (the model retries or works around
				     them), so the header stays in the same muted gray as every other
				     state; the amber icon is the only signal until the row is expanded. -->
				{#if toolError}
					<LucideTriangleAlert class="size-3.5 shrink-0 text-amber-500 dark:text-amber-400" />
				{/if}
				<span
					class="shrink-0 text-sm font-medium transition-colors group-hover/header:text-gray-600 dark:group-hover/header:text-gray-300 {isOpen
						? 'text-gray-600 dark:text-gray-300'
						: 'text-gray-500 dark:text-gray-400'}"
					class:router-shimmer={isExecuting}
				>
					{toolError ? "Error calling" : toolDone ? "Called" : "Calling"} tool
				</span>
				<code
					class="min-w-0 truncate rounded-sm bg-blue-50 px-1 py-px font-mono text-xs text-blue-700 opacity-90 dark:bg-blue-900/30 dark:text-blue-300"
				>
					{availableTools.find((entry) => entry.name === toolFnName)?.displayName ?? toolFnName}
				</code>
				<CarbonChevronRight
					class="size-3.5 shrink-0 transition-all duration-200 group-hover/header:text-gray-600 dark:group-hover/header:text-gray-300 {isOpen
						? 'rotate-90 text-gray-600 dark:text-gray-300'
						: 'text-gray-400'}"
				/>
			</button>
			{#if isExecuting && toolProgress}
				<span class="text-xs text-gray-500 dark:text-gray-400">{progressLabel}</span>
			{/if}
			{#each dashboards as dashboard (dashboard.url)}
				<button
					type="button"
					class="btn flex max-w-full items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs {dashboard.url ===
					openDashboardUrl
						? 'border-blue-300 text-blue-700 dark:border-blue-500/40 dark:text-blue-300'
						: 'border-gray-200 text-gray-500 hover:border-gray-300 hover:text-gray-700 dark:border-gray-700 dark:text-gray-400 dark:hover:border-gray-600 dark:hover:text-gray-300'}"
					title="Open the Trackio dashboard: {dashboard.label}"
					onclick={() => sidePane.openTrackio(dashboard.url, dashboard.label)}
				>
					<CarbonChartLine class="size-3.5 shrink-0" />
					<span class="truncate">
						{dashboards.length > 1 ? dashboard.label : "Training dashboard"}
					</span>
				</button>
			{/each}
		</div>

		<!-- Expandable content -->
		{#if isOpen}
			<div class="mt-2 mb-4 space-y-3 text-gray-500 dark:text-gray-400">
				{#each tool as update, i (`${update.subtype}-${i}`)}
					{#if update.subtype === MessageToolUpdateType.Call}
						<div class="space-y-1">
							<div class="text-[10px] font-semibold text-gray-400 uppercase dark:text-gray-500">
								Input
							</div>
							<pre
								class="rounded-lg bg-gray-100 p-2 font-mono text-xs break-all whitespace-pre-wrap dark:bg-gray-800/70">{formatValue(
									update.call.parameters
								)}</pre>
						</div>
					{:else if update.subtype === MessageToolUpdateType.Error}
						<div class="space-y-1">
							<div class="text-[10px] font-semibold text-amber-600 uppercase dark:text-amber-400">
								Error
							</div>
							<pre
								class="rounded-lg bg-amber-50 p-2 font-mono text-xs break-all whitespace-pre-wrap text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">{update.message}</pre>
						</div>
					{:else if isMessageToolResultUpdate(update) && update.result.status === ToolResultStatus.Success && update.result.display}
						<div class="space-y-1">
							<div class="text-[10px] font-semibold text-gray-400 uppercase dark:text-gray-500">
								Output
							</div>
							{#each parseToolOutputs(update.result.outputs) as parsedOutput}
								<div class="space-y-2">
									{#if parsedOutput.text}
										<pre
											class="scrollbar-custom max-h-60 overflow-y-auto rounded-lg bg-gray-100 p-2 font-mono text-xs break-all whitespace-pre-wrap dark:bg-gray-800/70">{parsedOutput.text}</pre>
									{/if}

									{#if parsedOutput.images.length > 0}
										<div class="flex flex-wrap gap-2">
											{#each parsedOutput.images as image, imageIndex}
												<img
													alt={`Tool result image ${imageIndex + 1}`}
													class="max-h-60 cursor-pointer rounded-sm border border-gray-200 dark:border-gray-700"
													src={`data:${image.mimeType};base64,${image.data}`}
												/>
											{/each}
										</div>
									{/if}

									{#if parsedOutput.metadata.length > 0}
										<pre
											class="rounded-lg bg-gray-100 p-2 font-mono text-xs break-all whitespace-pre-wrap dark:bg-gray-800/70">{formatValue(
												Object.fromEntries(parsedOutput.metadata)
											)}</pre>
									{/if}
								</div>
							{/each}
						</div>
					{:else if isMessageToolResultUpdate(update) && update.result.status === ToolResultStatus.Error && update.result.display}
						<div class="space-y-1">
							<div class="text-[10px] font-semibold text-amber-600 uppercase dark:text-amber-400">
								Error
							</div>
							<pre
								class="rounded-lg bg-amber-50 p-2 font-mono text-xs break-all whitespace-pre-wrap text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">{update
									.result.message}</pre>
						</div>
					{/if}
				{/each}
			</div>
		{/if}
	</BlockWrapper>
{/if}
