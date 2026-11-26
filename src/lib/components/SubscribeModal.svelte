<script lang="ts">
	import Modal from "$lib/components/Modal.svelte";
	import { isPro } from "$lib/stores/isPro";
	import { useAPIClient, handleResponse } from "$lib/APIClient";
	import {
		CREDIT_ESTIMATE_USD,
		estimateTokens,
		formatTokenCount,
		type ProviderPricing,
	} from "$lib/utils/creditEstimate";
	import LucideCoins from "~icons/lucide/coins";
	import CarbonArrowRight from "~icons/carbon/arrow-right";

	interface Props {
		close: () => void;
		/** model the failed request ran on, prices the credits to tokens estimate */
		model?: { id: string; providerOverride?: string };
	}

	let { close, model }: Props = $props();

	const client = useAPIClient();
	let estimate: { modelName: string; tokens: number } | undefined = $state();

	$effect(() => {
		estimate = undefined;
		if (!model) return;
		const { id, providerOverride } = model;
		let stale = false;
		client
			.models({ id })
			.get()
			.then(handleResponse)
			.then(
				(
					detail: {
						displayName?: string;
						defaultProvider?: string;
						providers?: ProviderPricing[];
					} | null
				) => {
					if (stale || !detail) return;
					const tokens = estimateTokens(detail.providers, {
						providerOverride,
						defaultProvider: detail.defaultProvider,
					});
					if (tokens !== undefined) estimate = { modelName: detail.displayName ?? id, tokens };
				}
			)
			// the modal still works without the estimate
			.catch(() => {});
		return () => {
			stale = true;
		};
	});
</script>

<Modal closeOnBackdrop={false} onclose={close} width="max-w-[420px]! m-4!">
	<div
		class="flex w-full flex-col gap-6 bg-white bg-linear-to-b to-transparent px-6 pb-6 dark:bg-black dark:from-white/10 dark:to-white/5"
	>
		<div
			class="-mx-6 grid h-44 place-items-center bg-linear-to-t from-black/5 select-none dark:from-white/10"
		>
			<div class="flex flex-col items-center justify-center gap-2.5 px-8 text-center">
				<div
					class="flex size-14 items-center justify-center rounded-full text-2xl text-amber-600 dark:text-amber-400 {$isPro
						? 'bg-linear-to-br from-yellow-500/15 via-orange-500/15 to-red-500/15'
						: 'bg-linear-to-br from-pink-500/15 from-15% via-green-500/15 to-yellow-500/15'}"
				>
					<LucideCoins />
				</div>
				<h2 class="text-2xl font-semibold text-gray-900 dark:text-gray-100">Out of credits</h2>
			</div>
		</div>

		<div class="text-gray-700 dark:text-gray-200">
			<p class="text-[15px] leading-relaxed">
				{#if $isPro}
					You've used all your available credits. Add credits to keep using HuggingChat.
				{:else}
					Add credits to keep using HuggingChat. You pay provider rates, with no markup.
				{/if}
			</p>

			{#if estimate}
				<div
					class="mt-4 rounded-xl bg-gray-100 px-4 py-3 dark:bg-white/5"
					data-testid="credit-estimate"
				>
					<div class="flex items-center justify-center gap-4">
						<div class="flex flex-col items-center">
							<span class="text-2xl font-semibold text-gray-900 dark:text-gray-100"
								>${CREDIT_ESTIMATE_USD}</span
							>
							<span class="text-xs text-gray-500 dark:text-gray-400">credits</span>
						</div>
						<CarbonArrowRight class="text-gray-400 dark:text-gray-500" />
						<div class="flex flex-col items-center">
							<span class="text-2xl font-semibold text-gray-900 dark:text-gray-100"
								>~{formatTokenCount(estimate.tokens)}</span
							>
							<span class="text-xs text-gray-500 dark:text-gray-400">tokens</span>
						</div>
					</div>
					<p
						class="mt-1.5 truncate text-center font-mono text-xs text-gray-600 dark:text-gray-300"
						title={estimate.modelName}
					>
						{estimate.modelName}
					</p>
				</div>
			{/if}
		</div>

		<div class="flex flex-col gap-2.5">
			<a
				href="https://huggingface.co/settings/billing?add-credits=true"
				target="_blank"
				rel="noopener noreferrer"
				class="w-full rounded-xl bg-black px-5 py-2.5 text-center text-base font-medium text-white hover:bg-gray-800 dark:bg-white dark:text-black dark:hover:bg-gray-200"
			>
				Add credits
			</a>
			{#if !$isPro}
				<a
					href="https://huggingface.co/subscribe/pro?from=HuggingChat"
					target="_blank"
					rel="noopener noreferrer"
					class="w-full rounded-xl border border-gray-300 px-5 py-2.5 text-center text-base font-medium text-gray-800 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-100 dark:hover:bg-white/5"
				>
					Upgrade to PRO
					<span class="font-normal text-gray-500 dark:text-gray-400"
						>· ${CREDIT_ESTIMATE_USD} credits monthly</span
					>
				</a>
			{/if}
			<button
				class="w-full py-1.5 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
				onclick={close}
			>
				Maybe later
			</button>
		</div>
	</div>
</Modal>
