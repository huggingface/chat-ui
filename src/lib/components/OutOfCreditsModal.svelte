<script lang="ts">
	import { base } from "$app/paths";
	import Modal from "$lib/components/Modal.svelte";
	import { isPro } from "$lib/stores/isPro";
	import { useSettingsStore } from "$lib/stores/settings";
	import { useAPIClient, handleResponse } from "$lib/APIClient";
	import { outOfCreditsCopy } from "$lib/utils/outOfCredits";
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

	const settings = useSettingsStore();
	let copy = $derived(
		outOfCreditsCopy({
			isPro: $isPro,
			billingOrganization: $settings.billingOrganization,
			settingsHref: `${base}/settings/application`,
		})
	);

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
					class="flex size-14 items-center justify-center rounded-full bg-linear-to-br from-yellow-500/15 via-orange-500/15 to-red-500/15 text-2xl text-amber-600 dark:text-amber-400"
				>
					<LucideCoins />
				</div>
				<h2 class="text-2xl font-semibold text-gray-900 dark:text-gray-100">{copy.title}</h2>
			</div>
		</div>

		<div class="text-gray-700 dark:text-gray-200">
			<p class="text-[15px] leading-relaxed">{copy.body}</p>

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
				href={copy.primary.href}
				target={copy.primary.external ? "_blank" : undefined}
				rel={copy.primary.external ? "noopener noreferrer" : undefined}
				class="w-full rounded-xl bg-black px-5 py-2.5 text-center text-base font-medium text-white hover:bg-gray-800 dark:bg-white dark:text-black dark:hover:bg-gray-200"
			>
				{copy.primary.label}
			</a>
			{#if copy.secondary}
				<a
					href={copy.secondary.href}
					target={copy.secondary.external ? "_blank" : undefined}
					rel={copy.secondary.external ? "noopener noreferrer" : undefined}
					onclick={copy.secondary.external ? undefined : close}
					class="w-full rounded-xl border border-gray-300 px-5 py-2.5 text-center text-base font-medium text-gray-800 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-100 dark:hover:bg-white/5"
				>
					{copy.secondary.label}
					{#if copy.secondary.hint}
						<span class="font-normal text-gray-500 dark:text-gray-400">· {copy.secondary.hint}</span
						>
					{/if}
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
