<script lang="ts">
	import type { MessageDebugUpdate } from "$lib/types/MessageUpdate";
	import CarbonChevronDown from "~icons/carbon/chevron-down";
	import CarbonChevronUp from "~icons/carbon/chevron-up";
	import { MessageUpdateType } from "$lib/types/MessageUpdate";

	interface Props {
		debugUpdate: MessageDebugUpdate;
	}

	let { debugUpdate } = $props();
	let expanded = $state(false);
</script>

<div class="mt-2 rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs dark:border-gray-700 dark:bg-gray-800/50">
	<button
		onclick={() => (expanded = !expanded)}
		class="flex w-full items-center justify-between text-left font-semibold text-gray-700 dark:text-gray-300"
	>
		<span>🔍 Debug Information</span>
		{#if expanded}
			<CarbonChevronUp class="h-4 w-4" />
		{:else}
			<CarbonChevronDown class="h-4 w-4" />
		{/if}
	</button>

	{#if expanded}
		<div class="mt-2 space-y-3">
			<!-- Timing Information -->
			<div class="rounded border border-gray-200 bg-white p-2 dark:border-gray-700 dark:bg-gray-800">
				<div class="text-xs font-semibold text-gray-700 dark:text-gray-300">Timing Information</div>
				<div class="mt-1 space-y-1 text-xs">
					{#if debugUpdate.securityResponseTime !== undefined}
						<div class="flex justify-between">
							<span class="text-gray-600 dark:text-gray-400">Security API Response Time:</span>
							<span class="font-mono">{debugUpdate.securityResponseTime.toFixed(0)}ms</span>
						</div>
					{/if}
					{#if debugUpdate.llmResponseTime !== undefined}
						<div class="flex justify-between">
							<span class="text-gray-600 dark:text-gray-400">LLM Response Time:</span>
							<span class="font-mono">{debugUpdate.llmResponseTime.toFixed(0)}ms</span>
						</div>
					{/if}
					{#if debugUpdate.totalTime !== undefined}
						<div class="flex justify-between border-t border-gray-200 pt-1 dark:border-gray-700">
							<span class="font-semibold text-gray-700 dark:text-gray-300">Total Time:</span>
							<span class="font-mono font-semibold">{debugUpdate.totalTime.toFixed(0)}ms</span>
						</div>
					{/if}
				</div>
			</div>

			<!-- Security Response -->
			{#if debugUpdate.securityResponse}
				<div class="rounded border border-gray-200 bg-white p-2 dark:border-gray-700 dark:bg-gray-800">
					<div class="text-xs font-semibold text-gray-700 dark:text-gray-300">Security Response</div>
					<div class="mt-1 space-y-1 text-xs">
						<div class="flex items-center gap-2">
							<span class="text-gray-600 dark:text-gray-400">Action:</span>
							<span
								class="rounded px-2 py-0.5 text-xs font-medium {debugUpdate.securityResponse.action === 'allow'
									? 'bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-400'
									: debugUpdate.securityResponse.action === 'block'
										? 'bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-400'
										: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-400'}"
							>
								{debugUpdate.securityResponse.action}
							</span>
						</div>
						{#if debugUpdate.securityResponse.reason}
							<div>
								<span class="text-gray-600 dark:text-gray-400">Reason:</span>
								<span class="ml-1">{debugUpdate.securityResponse.reason}</span>
							</div>
						{/if}
					</div>
				</div>
			{/if}

			<!-- Original Request -->
			{#if debugUpdate.originalRequest}
				<details class="rounded border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
					<summary class="cursor-pointer p-2 text-xs font-semibold text-gray-700 dark:text-gray-300">
						원본 요청 (Original Request)
					</summary>
					<pre
						class="max-h-60 overflow-auto p-2 text-xs dark:bg-gray-900"
					>{JSON.stringify(debugUpdate.originalRequest, null, 2)}</pre>
				</details>
			{/if}

			<!-- Security Response (Full) -->
			{#if debugUpdate.securityResponse?.modifiedKwargs}
				<details class="rounded border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
					<summary class="cursor-pointer p-2 text-xs font-semibold text-gray-700 dark:text-gray-300">
						보안 응답 결과 (Security Response)
					</summary>
					<pre
						class="max-h-60 overflow-auto p-2 text-xs dark:bg-gray-900"
					>{JSON.stringify(debugUpdate.securityResponse.modifiedKwargs, null, 2)}</pre>
				</details>
			{/if}

			<!-- LLM Request -->
			{#if debugUpdate.llmRequest}
				<details class="rounded border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
					<summary class="cursor-pointer p-2 text-xs font-semibold text-gray-700 dark:text-gray-300">
						LLM에게 전달된 요청 (LLM Request)
					</summary>
					<pre
						class="max-h-60 overflow-auto p-2 text-xs dark:bg-gray-900"
					>{JSON.stringify(debugUpdate.llmRequest, null, 2)}</pre>
				</details>
			{/if}

			<!-- Final LLM Response -->
			{#if debugUpdate.finalLlmResponse}
				<details class="rounded border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
					<summary class="cursor-pointer p-2 text-xs font-semibold text-gray-700 dark:text-gray-300">
						최종 응답 (Final LLM Response)
					</summary>
					<pre
						class="max-h-60 overflow-auto p-2 text-xs dark:bg-gray-900"
					>{JSON.stringify(debugUpdate.finalLlmResponse, null, 2)}</pre>
				</details>
			{/if}

			<!-- Error -->
			{#if debugUpdate.error}
				<div class="rounded border border-red-200 bg-red-50 p-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-900/20 dark:text-red-400">
					<span class="font-semibold">Error:</span> {debugUpdate.error}
				</div>
			{/if}
		</div>
	{/if}
</div>

