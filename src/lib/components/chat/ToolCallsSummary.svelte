<script lang="ts">
	import { MessageToolUpdateType, type MessageToolUpdate } from "$lib/types/MessageUpdate";
	import {
		isMessageToolCallUpdate,
		isMessageToolErrorUpdate,
		isMessageToolResultUpdate,
	} from "$lib/utils/messageUpdates";
	import LucideCheck from "~icons/lucide/check";
	import LucideX from "~icons/lucide/x";
	import LucideWrench from "~icons/lucide/wrench";
	import CarbonChevronRight from "~icons/carbon/chevron-right";
	import { page } from "$app/state";
	import { ToolResultStatus, type ToolFront } from "$lib/types/Tool";

	interface ToolGroup {
		uuid: string;
		updates: MessageToolUpdate[];
	}

	interface Props {
		toolGroups: ToolGroup[];
	}

	let { toolGroups }: Props = $props();

	let isOpen = $state(false);

	const availableTools: ToolFront[] = $derived.by(
		() => (page.data as { tools?: ToolFront[] } | undefined)?.tools ?? []
	);

	// Derive summary information
	let summary = $derived.by(() => {
		let completed = 0;
		let errors = 0;
		let inProgress = 0;
		const toolNames: Array<{
			name: string;
			displayName: string;
			status: "done" | "error" | "running";
		}> = [];

		for (const group of toolGroups) {
			const callUpdate = group.updates.find(isMessageToolCallUpdate);
			const hasResult = group.updates.some(isMessageToolResultUpdate);
			const hasError = group.updates.some(isMessageToolErrorUpdate);

			const name = callUpdate?.call.name ?? "unknown";
			const displayName = availableTools.find((t) => t.name === name)?.displayName ?? name;

			if (hasError) {
				errors++;
				toolNames.push({ name, displayName, status: "error" });
			} else if (hasResult) {
				completed++;
				toolNames.push({ name, displayName, status: "done" });
			} else {
				inProgress++;
				toolNames.push({ name, displayName, status: "running" });
			}
		}

		return { completed, errors, inProgress, total: toolGroups.length, toolNames };
	});

	let allDone = $derived(summary.inProgress === 0);
	let hasErrors = $derived(summary.errors > 0);

	// Detailed tool information for expanded view
	type ToolOutput = Record<string, unknown>;

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
</script>

<div
	data-exclude-from-copy
	class="mb-3 rounded-lg border border-gray-200 bg-gray-50/50 dark:border-gray-700 dark:bg-gray-800/30"
>
	<!-- Summary Header -->
	<button
		type="button"
		class="flex w-full cursor-pointer items-center gap-3 px-3 py-2.5"
		onclick={() => (isOpen = !isOpen)}
	>
		<!-- Icon -->
		<div
			class="flex size-6 flex-shrink-0 items-center justify-center rounded-md {hasErrors
				? 'bg-red-100 dark:bg-red-900/30'
				: 'bg-purple-100 dark:bg-purple-900/30'}"
		>
			<LucideWrench
				class="size-3.5 {hasErrors
					? 'text-red-500 dark:text-red-400'
					: 'text-purple-600 dark:text-purple-400'}"
			/>
		</div>

		<!-- Summary Text -->
		<div class="flex flex-1 flex-col items-start gap-0.5">
			<span class="text-sm font-medium text-gray-700 dark:text-gray-200">
				{#if allDone}
					Used {summary.total} tool{summary.total !== 1 ? "s" : ""}
				{:else}
					Using tools ({summary.completed + summary.errors}/{summary.total})
				{/if}
			</span>
			<!-- Tool names preview in collapsed state -->
			{#if !isOpen}
				<span class="line-clamp-1 text-xs text-gray-500 dark:text-gray-400">
					{summary.toolNames.map((t) => t.displayName).join(", ")}
				</span>
			{/if}
		</div>

		<!-- Status indicators -->
		<div class="flex items-center gap-2">
			{#if summary.errors > 0}
				<span
					class="flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-600 dark:bg-red-900/30 dark:text-red-400"
				>
					<LucideX class="size-3" />
					{summary.errors}
				</span>
			{/if}
			{#if summary.completed > 0}
				<span
					class="flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400"
				>
					<LucideCheck class="size-3" />
					{summary.completed}
				</span>
			{/if}
			<CarbonChevronRight
				class="size-4 text-gray-400 transition-transform duration-200 {isOpen ? 'rotate-90' : ''}"
			/>
		</div>
	</button>

	<!-- Expanded Details -->
	{#if isOpen}
		<div class="border-t border-gray-200 dark:border-gray-700">
			<div class="divide-y divide-gray-100 dark:divide-gray-700/50">
				{#each toolGroups as group (group.uuid)}
					{@const callUpdate = group.updates.find(isMessageToolCallUpdate)}
					{@const resultUpdate = group.updates.find(isMessageToolResultUpdate)}
					{@const errorUpdate = group.updates.find(isMessageToolErrorUpdate)}
					{@const toolName = callUpdate?.call.name ?? "unknown"}
					{@const displayName =
						availableTools.find((t) => t.name === toolName)?.displayName ?? toolName}
					{@const isDone = !!resultUpdate || !!errorUpdate}
					{@const hasError = !!errorUpdate}

					<div class="px-3 py-2.5">
						<!-- Tool header -->
						<div class="flex items-center gap-2">
							<div
								class="flex size-5 items-center justify-center rounded {hasError
									? 'bg-red-100 dark:bg-red-900/30'
									: isDone
										? 'bg-emerald-100 dark:bg-emerald-900/30'
										: 'bg-gray-100 dark:bg-gray-700'}"
							>
								{#if hasError}
									<LucideX class="size-3 text-red-500 dark:text-red-400" />
								{:else if isDone}
									<LucideCheck class="size-3 text-emerald-500 dark:text-emerald-400" />
								{:else}
									<div
										class="size-2 animate-pulse rounded-full bg-purple-500 dark:bg-purple-400"
									></div>
								{/if}
							</div>
							<code
								class="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs text-gray-600 dark:bg-gray-700 dark:text-gray-300"
							>
								{displayName}
							</code>
						</div>

						<!-- Input parameters (collapsed by default, shown on hover or always visible) -->
						{#if callUpdate}
							<details class="mt-2">
								<summary
									class="cursor-pointer text-[10px] font-semibold uppercase tracking-wider text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
								>
									Input
								</summary>
								<div
									class="mt-1 rounded-md border border-gray-100 bg-white p-2 text-gray-500 dark:border-gray-600 dark:bg-gray-800/50 dark:text-gray-400"
								>
									<pre
										class="max-h-32 overflow-auto whitespace-pre-wrap break-all font-mono text-xs">{formatValue(
											callUpdate.call.parameters
										)}</pre>
								</div>
							</details>
						{/if}

						<!-- Error -->
						{#if errorUpdate && errorUpdate.subtype === MessageToolUpdateType.Error}
							<div class="mt-2">
								<div
									class="text-[10px] font-semibold uppercase tracking-wider text-red-500 dark:text-red-400"
								>
									Error
								</div>
								<div
									class="mt-1 rounded-md border border-red-200 bg-red-50 p-2 text-red-600 dark:border-red-500/30 dark:bg-red-900/20 dark:text-red-400"
								>
									<pre
										class="whitespace-pre-wrap break-all font-mono text-xs">{errorUpdate.message}</pre>
								</div>
							</div>
						{/if}

						<!-- Success output -->
						{#if resultUpdate && resultUpdate.result.status === ToolResultStatus.Success && resultUpdate.result.display}
							<details class="mt-2">
								<summary
									class="cursor-pointer text-[10px] font-semibold uppercase tracking-wider text-emerald-500 hover:text-emerald-600 dark:text-emerald-400 dark:hover:text-emerald-300"
								>
									Output
								</summary>
								<div
									class="scrollbar-custom mt-1 max-h-40 overflow-auto rounded-md border border-gray-100 bg-white p-2 text-gray-500 dark:border-gray-600 dark:bg-gray-800/50 dark:text-gray-400"
								>
									{#each resultUpdate.result.outputs as output}
										{@const text = getOutputText(output)}
										{#if text}
											<pre class="whitespace-pre-wrap break-all font-mono text-xs">{text}</pre>
										{:else}
											<pre class="whitespace-pre-wrap break-all font-mono text-xs">{formatValue(
													output
												)}</pre>
										{/if}
									{/each}
								</div>
							</details>
						{/if}

						<!-- Error result -->
						{#if resultUpdate && resultUpdate.result.status === ToolResultStatus.Error && resultUpdate.result.display}
							<div class="mt-2">
								<div
									class="text-[10px] font-semibold uppercase tracking-wider text-red-500 dark:text-red-400"
								>
									Error
								</div>
								<div
									class="mt-1 rounded-md border border-red-200 bg-red-50 p-2 text-red-600 dark:border-red-500/30 dark:bg-red-900/20 dark:text-red-400"
								>
									<pre class="whitespace-pre-wrap break-all font-mono text-xs">{resultUpdate.result
											.message}</pre>
								</div>
							</div>
						{/if}
					</div>
				{/each}
			</div>
		</div>
	{/if}
</div>
