<script lang="ts">
	import { MessageToolUpdateType, type MessageToolUpdate } from "$lib/types/MessageUpdate";
	import {
		isMessageToolApprovalRequestUpdate,
		isMessageToolApprovalResolvedUpdate,
		isMessageToolCallUpdate,
		isMessageToolErrorUpdate,
		isMessageToolProgressUpdate,
		isMessageToolResultUpdate,
	} from "$lib/utils/messageUpdates";
	import { formatToolProgressLabel } from "$lib/utils/toolProgress";
	import LucideHammer from "~icons/lucide/hammer";
	import LucideCheck from "~icons/lucide/check";
	import LucideShieldAlert from "~icons/lucide/shield-alert";
	import { ToolResultStatus, type ToolFront } from "$lib/types/Tool";
	import { page } from "$app/state";
	import CarbonChevronRight from "~icons/carbon/chevron-right";
	import BlockWrapper from "./BlockWrapper.svelte";
	import { base } from "$app/paths";

	interface Props {
		tool: MessageToolUpdate[];
		loading?: boolean;
		hasNext?: boolean;
	}

	let { tool, loading = false, hasNext = false }: Props = $props();

	let isOpen = $state(false);

	let approvalRequest = $derived(tool.find(isMessageToolApprovalRequestUpdate));
	let approvalResolved = $derived(tool.find(isMessageToolApprovalResolvedUpdate));
	let awaitingApproval = $derived(Boolean(approvalRequest && !approvalResolved));
	let wasDenied = $derived(approvalResolved?.decision === "deny");

	let toolFnName = $derived(
		tool.find(isMessageToolCallUpdate)?.call.name ?? approvalRequest?.toolName
	);
	let toolError = $derived(tool.some(isMessageToolErrorUpdate));
	let toolDone = $derived(tool.some(isMessageToolResultUpdate));
	let isExecuting = $derived(!toolDone && !toolError && !awaitingApproval && loading);
	let toolSuccess = $derived(toolDone && !toolError);
	let toolProgress = $derived.by(() => {
		for (let i = tool.length - 1; i >= 0; i -= 1) {
			const update = tool[i];
			if (isMessageToolProgressUpdate(update)) return update;
		}
		return undefined;
	});
	let progressLabel = $derived.by(() => formatToolProgressLabel(toolProgress));

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

	// Icon styling based on state
	let iconBg = $derived(
		awaitingApproval
			? "bg-amber-100 dark:bg-amber-900/40"
			: toolError
				? "bg-red-100 dark:bg-red-900/40"
				: "bg-purple-100 dark:bg-purple-900/40"
	);

	let iconRing = $derived(
		awaitingApproval
			? "ring-amber-200 dark:ring-amber-500/30"
			: toolError
				? "ring-red-200 dark:ring-red-500/30"
				: "ring-purple-200 dark:ring-purple-500/30"
	);

	let pendingDecision = $state<"allow" | "deny" | "always" | undefined>(undefined);
	let approvalError = $state<string | undefined>(undefined);

	async function submitDecision(decision: "allow" | "deny" | "always") {
		if (!approvalRequest || pendingDecision) return;
		pendingDecision = decision;
		approvalError = undefined;
		try {
			const res = await fetch(`${base}/api/mcp/approve`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ approvalId: approvalRequest.approvalId, decision }),
			});
			if (!res.ok) {
				approvalError = `Failed to submit decision (${res.status})`;
				pendingDecision = undefined;
			}
		} catch (err) {
			approvalError = err instanceof Error ? err.message : String(err);
			pendingDecision = undefined;
		}
	}
</script>

{#snippet icon()}
	{#if awaitingApproval}
		<LucideShieldAlert class="size-3.5 text-amber-600 dark:text-amber-400" />
	{:else if toolSuccess}
		<LucideCheck class="size-3.5 text-purple-600 dark:text-purple-400" />
	{:else}
		<LucideHammer
			class="size-3.5 {toolError
				? 'text-red-500 dark:text-red-400'
				: 'text-purple-600 dark:text-purple-400'}"
		/>
	{/if}
{/snippet}

{#if toolFnName}
	<BlockWrapper {icon} {iconBg} {iconRing} {hasNext} loading={isExecuting || awaitingApproval}>
		<!-- Header row -->
		<div class="flex w-full select-none items-center gap-2">
			<button
				type="button"
				class="flex flex-1 cursor-pointer flex-col items-start gap-1 text-left"
				onclick={() => (isOpen = !isOpen)}
			>
				<span
					class="text-sm font-medium {awaitingApproval
						? 'text-amber-700 dark:text-amber-300'
						: isExecuting
							? 'text-purple-700 dark:text-purple-300'
							: toolError
								? 'text-red-600 dark:text-red-400'
								: 'text-gray-700 dark:text-gray-300'}"
				>
					{#if awaitingApproval}
						Approve tool
					{:else if wasDenied}
						Denied tool
					{:else if toolError}
						Error calling tool
					{:else if toolDone}
						Called tool
					{:else}
						Calling tool
					{/if}
					<code
						class="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs text-gray-500 opacity-90 dark:bg-gray-800 dark:text-gray-400"
					>
						{availableTools.find((entry) => entry.name === toolFnName)?.displayName ?? toolFnName}
					</code>
					{#if awaitingApproval && approvalRequest?.serverName}
						<span class="ml-1 text-xs text-amber-700/80 dark:text-amber-400/80">
							from {approvalRequest.serverName}
						</span>
					{/if}
				</span>
				{#if isExecuting && toolProgress}
					<span class="text-xs text-gray-500 dark:text-gray-400">{progressLabel}</span>
				{/if}
			</button>

			<button
				type="button"
				class="cursor-pointer"
				onclick={() => (isOpen = !isOpen)}
				aria-label={isOpen ? "Collapse" : "Expand"}
			>
				<CarbonChevronRight
					class="size-4 text-gray-400 transition-transform duration-200 {isOpen ? 'rotate-90' : ''}"
				/>
			</button>
		</div>

		<!-- Approval card (shown while awaiting approval) -->
		{#if awaitingApproval && approvalRequest}
			<div class="mt-2 space-y-2">
				<div class="text-xs text-gray-600 dark:text-gray-400">
					This tool wants to run with the arguments below. Approving it will let the model invoke it
					and share the result.
				</div>
				{#if Object.keys(approvalRequest.args ?? {}).length > 0}
					<div class="space-y-1">
						<div
							class="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500"
						>
							Arguments
						</div>
						<div
							class="rounded-md border border-amber-200 bg-amber-50 p-2 text-amber-900 dark:border-amber-500/30 dark:bg-amber-900/20 dark:text-amber-200"
						>
							<pre class="whitespace-pre-wrap break-all font-mono text-xs">{formatValue(
									approvalRequest.args
								)}</pre>
						</div>
					</div>
				{/if}
				<div class="flex flex-wrap gap-2 pt-1">
					<button
						type="button"
						class="rounded-md bg-amber-600 px-3 py-1 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-60 dark:bg-amber-500 dark:hover:bg-amber-600"
						onclick={() => submitDecision("allow")}
						disabled={pendingDecision !== undefined}
					>
						Allow once
					</button>
					<button
						type="button"
						class="rounded-md border border-gray-300 bg-white px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
						onclick={() => submitDecision("always")}
						disabled={pendingDecision !== undefined}
					>
						Always allow this tool
					</button>
					<button
						type="button"
						class="rounded-md border border-red-300 bg-white px-3 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-60 dark:border-red-500/50 dark:bg-gray-800 dark:text-red-400 dark:hover:bg-red-900/30"
						onclick={() => submitDecision("deny")}
						disabled={pendingDecision !== undefined}
					>
						Deny
					</button>
				</div>
				{#if approvalError}
					<div class="text-xs text-red-600 dark:text-red-400">{approvalError}</div>
				{/if}
			</div>
		{/if}

		<!-- Expandable content -->
		{#if isOpen}
			<div class="mt-2 space-y-3">
				{#each tool as update, i (`${update.subtype}-${i}`)}
					{#if update.subtype === MessageToolUpdateType.Call}
						<div class="space-y-1">
							<div
								class="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500"
							>
								Input
							</div>
							<div
								class="rounded-md border border-gray-100 bg-white p-2 text-gray-500 dark:border-gray-700 dark:bg-gray-800/50 dark:text-gray-400"
							>
								<pre class="whitespace-pre-wrap break-all font-mono text-xs">{formatValue(
										update.call.parameters
									)}</pre>
							</div>
						</div>
					{:else if update.subtype === MessageToolUpdateType.Error}
						<div class="space-y-1">
							<div
								class="text-[10px] font-semibold uppercase tracking-wider text-red-500 dark:text-red-400"
							>
								Error
							</div>
							<div
								class="rounded-md border border-red-200 bg-red-50 p-2 text-red-600 dark:border-red-500/30 dark:bg-red-900/20 dark:text-red-400"
							>
								<pre class="whitespace-pre-wrap break-all font-mono text-xs">{update.message}</pre>
							</div>
						</div>
					{:else if isMessageToolResultUpdate(update) && update.result.status === ToolResultStatus.Success && update.result.display}
						<div class="space-y-1">
							<div class="flex items-center gap-2">
								<div
									class="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500"
								>
									Output
								</div>
								<svg
									xmlns="http://www.w3.org/2000/svg"
									width="12"
									height="12"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="2"
									stroke-linecap="round"
									stroke-linejoin="round"
									class="text-emerald-500"
								>
									<circle cx="12" cy="12" r="10"></circle>
									<path d="m9 12 2 2 4-4"></path>
								</svg>
							</div>
							<div
								class="scrollbar-custom rounded-md border border-gray-100 bg-white p-2 text-gray-500 dark:border-gray-700 dark:bg-gray-800/50 dark:text-gray-400"
							>
								{#each parseToolOutputs(update.result.outputs) as parsedOutput}
									<div class="space-y-2">
										{#if parsedOutput.text}
											<pre
												class="scrollbar-custom max-h-60 overflow-y-auto whitespace-pre-wrap break-all font-mono text-xs">{parsedOutput.text}</pre>
										{/if}

										{#if parsedOutput.images.length > 0}
											<div class="flex flex-wrap gap-2">
												{#each parsedOutput.images as image, imageIndex}
													<img
														alt={`Tool result image ${imageIndex + 1}`}
														class="max-h-60 cursor-pointer rounded border border-gray-200 dark:border-gray-700"
														src={`data:${image.mimeType};base64,${image.data}`}
													/>
												{/each}
											</div>
										{/if}

										{#if parsedOutput.metadata.length > 0}
											<pre class="whitespace-pre-wrap break-all font-mono text-xs">{formatValue(
													Object.fromEntries(parsedOutput.metadata)
												)}</pre>
										{/if}
									</div>
								{/each}
							</div>
						</div>
					{:else if isMessageToolResultUpdate(update) && update.result.status === ToolResultStatus.Error && update.result.display}
						<div class="space-y-1">
							<div
								class="text-[10px] font-semibold uppercase tracking-wider text-red-500 dark:text-red-400"
							>
								Error
							</div>
							<div
								class="rounded-md border border-red-200 bg-red-50 p-2 text-red-600 dark:border-red-500/30 dark:bg-red-900/20 dark:text-red-400"
							>
								<pre class="whitespace-pre-wrap break-all font-mono text-xs">{update.result
										.message}</pre>
							</div>
						</div>
					{/if}
				{/each}
			</div>
		{/if}
	</BlockWrapper>
{/if}
