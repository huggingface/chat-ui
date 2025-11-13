<script lang="ts">
	import type { MessageUpdate } from "$lib/types/MessageUpdate";
	import { MessageUpdateType, MessageUpdateStatus } from "$lib/types/MessageUpdate";
	import IconLoading from "../icons/IconLoading.svelte";
	import CarbonCheckmark from "~icons/carbon/checkmark";

	interface Props {
		updates: MessageUpdate[];
	}

	const { updates }: Props = $props();

	// Track Security API progress states
	let securityApiRequesting = $state(false);
	let securityApiResponded = $state(false);
	let llmRequesting = $state(false);
	let llmResponded = $state(false);
	let isDummyResponse = $state(false);

	// Update states based on updates
	$effect(() => {
		securityApiRequesting = false;
		securityApiResponded = false;
		llmRequesting = false;
		llmResponded = false;
		isDummyResponse = false;

		for (const update of updates) {
			if (update.type === MessageUpdateType.Status) {
				if (update.status === MessageUpdateStatus.SecurityApiRequesting) {
					securityApiRequesting = true;
				} else if (update.status === MessageUpdateStatus.SecurityApiResponded) {
					securityApiRequesting = false;
					securityApiResponded = true;
				} else if (update.status === MessageUpdateStatus.LlmRequesting) {
					llmRequesting = true;
				} else if (update.status === MessageUpdateStatus.LlmResponded) {
					llmRequesting = false;
					llmResponded = true;
				}
			} else if (update.type === MessageUpdateType.Debug) {
				if (update.isDummyResponse) {
					isDummyResponse = true;
				}
			}
		}
	});
</script>

{#if securityApiRequesting || securityApiResponded || llmRequesting || llmResponded}
	<div
		class="mb-2 rounded-lg border border-blue-200 bg-blue-50 p-2 text-xs dark:border-blue-800 dark:bg-blue-900/20"
	>
		<div class="flex items-center gap-2 font-semibold text-blue-700 dark:text-blue-300">
			<span>🔒 Security API 진행 상태</span>
			{#if isDummyResponse}
				<span
					class="rounded bg-yellow-100 px-1.5 py-0.5 text-xs font-medium text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400"
				>
					더미 응답
				</span>
			{/if}
		</div>
		<div class="mt-2 space-y-1.5">
			<!-- Security API Step -->
			<div class="flex items-center gap-2">
				{#if securityApiRequesting}
					<IconLoading classNames="h-4 w-4" />
				{:else if securityApiResponded}
					<CarbonCheckmark class="h-4 w-4 text-green-600 dark:text-green-400" />
				{:else}
					<div class="h-4 w-4 rounded-full border-2 border-gray-300 dark:border-gray-600"></div>
				{/if}
				<span
					class="text-xs {securityApiRequesting
						? 'text-blue-600 dark:text-blue-400'
						: securityApiResponded
							? 'text-green-600 dark:text-green-400'
							: 'text-gray-500 dark:text-gray-400'}"
				>
					Security API {securityApiRequesting
						? "요청 중..."
						: securityApiResponded
							? "응답 수신"
							: "대기 중"}
				</span>
			</div>

			<!-- LLM Step -->
			<div class="flex items-center gap-2">
				{#if llmRequesting}
					<IconLoading classNames="h-4 w-4" />
				{:else if llmResponded}
					<CarbonCheckmark class="h-4 w-4 text-green-600 dark:text-green-400" />
				{:else}
					<div class="h-4 w-4 rounded-full border-2 border-gray-300 dark:border-gray-600"></div>
				{/if}
				<span
					class="text-xs {llmRequesting
						? 'text-blue-600 dark:text-blue-400'
						: llmResponded
							? 'text-green-600 dark:text-green-400'
							: 'text-gray-500 dark:text-gray-400'}"
				>
					LLM {llmRequesting ? "요청 중..." : llmResponded ? "응답 수신" : "대기 중"}
				</span>
			</div>
		</div>
	</div>
{/if}
