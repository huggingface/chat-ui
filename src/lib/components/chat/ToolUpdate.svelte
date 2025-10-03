<script lang="ts">
	import type { MessageToolUpdate } from "$lib/types/MessageUpdate";
	import {
		isMessageToolCallUpdate,
		isMessageToolErrorUpdate,
		isMessageToolResultUpdate,
	} from "$lib/utils/messageUpdates";
	import CarbonCaretDown from "~icons/carbon/caret-down";
	import CarbonTools from "~icons/carbon/tools";
	import EosIconsLoading from "~icons/eos-icons/loading";
	import { ToolResultStatus, type ToolFront } from "$lib/types/Tool";
	import { page } from "$app/state";

	interface Props {
		tools: MessageToolUpdate[][];
		loading?: boolean;
	}

	let { tools, loading = false }: Props = $props();

	const toolsData = page.data as { tools?: ToolFront[] } | undefined;
	const availableTools: ToolFront[] = toolsData?.tools ?? [];

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

	type TimelineItem = {
		uuid: string;
		name: string;
		displayName: string;
		status: "pending" | "done" | "error";
		parameters: [string, unknown][];
		hasParameters: boolean;
		outputs?: Record<string, unknown>[];
		showOutputs: boolean;
		errorMessage?: string;
		showError: boolean;
		showHiddenErrorCopy: boolean;
	};

	const timelineItems = $derived.by(() =>
		tools
			.filter((group) => group.length > 0)
			.map((group) => {
				const uuid = group[0].uuid;
				const callUpdate = group.find(isMessageToolCallUpdate);
				const resultUpdate = group.find(isMessageToolResultUpdate);
				const inlineError = group.find(isMessageToolErrorUpdate);

				const name = callUpdate?.call.name ?? "tool";
				const displayName =
					availableTools.find((entry) => entry.name === name)?.displayName ?? name;
				const parametersEntries = Object.entries(callUpdate?.call.parameters ?? {});

				let status: "pending" | "done" | "error" = "pending";
				let outputs: Record<string, unknown>[] | undefined;
				let showOutputs = false;
				let errorMessage: string | undefined;
				let showError = false;
				let showHiddenErrorCopy = false;

				if (inlineError) {
					status = "error";
					errorMessage = inlineError.message;
					showError = true;
				} else if (resultUpdate) {
					if (resultUpdate.result.status === ToolResultStatus.Success) {
						status = "done";
						outputs = resultUpdate.result.outputs;
						showOutputs = !!resultUpdate.result.display && resultUpdate.result.outputs.length > 0;
					} else if (resultUpdate.result.status === ToolResultStatus.Error) {
						status = "error";
						errorMessage = resultUpdate.result.message;
						showError = !!resultUpdate.result.display;
						showHiddenErrorCopy = !resultUpdate.result.display;
					}
				}

				return {
					uuid,
					name,
					displayName,
					status,
					parameters: parametersEntries,
					hasParameters: parametersEntries.length > 0,
					outputs,
					showOutputs,
					errorMessage,
					showError,
					showHiddenErrorCopy,
				};
			})
	);

	const activeItem = $derived.by(() => timelineItems.find((item) => item.status === "pending"));

	const toolStats = $derived.by(() => {
		let total = 0;
		let errors = 0;
		let successes = 0;
		let pending = 0;
		for (const item of timelineItems) {
			total += 1;
			if (item.status === "error") {
				errors += 1;
			} else if (item.status === "done") {
				successes += 1;
			} else if (item.status === "pending") {
				pending += 1;
			}
		}
		return { total, errors, successes, pending };
	});

	const hasErrors = $derived(() => toolStats.errors > 0);

	const summaryText = $derived.by(() => {
		const current = activeItem;
		if (current) return `Calling ${current.displayName}`;
		const { total, errors, successes, pending } = toolStats;
		if (pending > 0) return "Running tools";
		if (total === 0) return loading ? "Initializing tools" : "No tool calls";
		if (errors === total) {
			return total === 1 ? "Tool call failed" : "All tool calls failed";
		}
		if (errors > 0) {
			return "Some tool calls failed";
		}
		if (successes === total) {
			return total === 1 ? "Tool call completed" : "Tools completed";
		}
		return "Tools completed";
	});
</script>

<details
	class="flex w-fit max-w-full flex-col rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900"
>
	<summary
		class="grid min-w-72 cursor-pointer select-none grid-cols-[40px,1fr,24px] items-center gap-2.5 rounded-xl p-2 hover:bg-gray-50 dark:hover:bg-gray-800/20"
	>
		<div
			class="relative grid aspect-square place-content-center overflow-hidden rounded-lg bg-purple-50 text-purple-600 dark:bg-purple-900/40 dark:text-purple-300"
		>
			<svg
				class="absolute inset-0 text-purple-500/50 transition-opacity"
				class:opacity-0={!activeItem}
				width="40"
				height="40"
				viewBox="0 0 38 38"
				fill="none"
				xmlns="http://www.w3.org/2000/svg"
			>
				<path
					class="loading-path"
					d="M8 2.5H30C30 2.5 35.5 2.5 35.5 8V30C35.5 30 35.5 35.5 30 35.5H8C8 35.5 2.5 35.5 2.5 30V8C2.5 8 2.5 2.5 8 2.5Z"
					stroke="currentColor"
					stroke-width="1"
					stroke-linecap="round"
					id="shape"
				/>
			</svg>
			<CarbonTools class="text-xl" />
		</div>
		<dl class="leading-4">
			<dd class="text-sm">Tools</dd>
			<dt
				class="flex items-center gap-1 truncate whitespace-nowrap text-[.82rem] text-gray-400"
				class:text-red-500={hasErrors}
			>
				{summaryText}
			</dt>
		</dl>
		<CarbonCaretDown
			class="size-5 rotate-[-90deg] text-gray-400 transition-transform group-open:rotate-0"
		/>
	</summary>

	<div class="content px-5 pb-5 pt-4">
		{#if timelineItems.length === 0}
			<div class="mx-auto w-fit">
				<EosIconsLoading class="mb-3 h-4 w-4" />
			</div>
		{:else}
			<ol>
				{#each timelineItems as item (item.uuid)}
					<li class="group border-l pb-6 last:!border-transparent last:pb-0 dark:border-gray-800">
						<div class="flex items-start gap-2">
							<div
								class="-ml-1.5 mt-1 h-3 w-3 flex-none rounded-full bg-purple-300 transition-colors dark:bg-purple-700"
								class:bg-purple-500={item.status === "done"}
								class:bg-red-500={item.status === "error"}
								class:animate-pulse={item.status === "pending"}
							></div>
							<div class="flex-1">
								<h3 class="text-md -mt-1.5 pl-2.5 text-gray-800 dark:text-gray-100">
									Called tool {item.displayName}
								</h3>
								<p
									class="pl-2.5 text-xs font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500"
								>
									{item.status === "pending"
										? "Running"
										: item.status === "done"
											? "Completed"
											: "Failed"}
								</p>

								{#if item.hasParameters}
									<div class="mt-2 space-y-1 pl-2.5 text-sm text-gray-500 dark:text-gray-400">
										<div
											class="text-[0.7rem] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500"
										>
											Parameters
										</div>
										<ul class="space-y-1">
											{#each item.parameters as [key, value]}
												<li>
													<span class="font-medium text-gray-600 dark:text-gray-300">{key}</span>:
													<span class="whitespace-pre-wrap">{formatValue(value)}</span>
												</li>
											{/each}
										</ul>
									</div>
								{/if}

								{#if item.showOutputs && item.outputs}
									<div class="mt-4 space-y-2 pl-2.5 text-sm text-gray-500 dark:text-gray-400">
										<div
											class="text-[0.7rem] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500"
										>
											Result
										</div>
										{#each item.outputs as output, outputIdx}
											<ul class="space-y-1" data-output={outputIdx}>
												{#each Object.entries(output) as [key, value]}
													<li>
														<span class="font-medium text-gray-600 dark:text-gray-300">{key}</span>:
														<span class="whitespace-pre-wrap">{formatValue(value)}</span>
													</li>
												{/each}
											</ul>
										{/each}
									</div>
								{/if}

								{#if item.status === "error"}
									<div class="mt-4 space-y-1 pl-2.5 text-sm">
										<div
											class="text-[0.7rem] font-semibold uppercase tracking-wide text-red-600 dark:text-red-400"
										>
											Error
										</div>
										{#if item.showError && item.errorMessage}
											<p class="whitespace-pre-wrap text-red-600 dark:text-red-400">
												{item.errorMessage}
											</p>
										{:else if item.showHiddenErrorCopy}
											<p class="text-gray-500 dark:text-gray-400">Tool returned an error.</p>
										{/if}
									</div>
								{/if}
							</div>
						</div>
					</li>
				{/each}
			</ol>
		{/if}
	</div>
</details>

<style>
	details summary::-webkit-details-marker {
		display: none;
	}

	@keyframes loading {
		0% {
			stroke-dashoffset: 61.45;
		}
		100% {
			stroke-dashoffset: 0;
		}
	}

	.loading-path {
		stroke-dasharray: 61.45;
		animation: loading 2s linear infinite;
	}
</style>
