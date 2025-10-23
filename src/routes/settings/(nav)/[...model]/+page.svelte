<script lang="ts">
	import { page } from "$app/state";
	import { base } from "$app/paths";

	import type { BackendModel } from "$lib/server/models";
	import type { ModelParameterOverrides } from "$lib/types/Settings";
	import IconOmni from "$lib/components/icons/IconOmni.svelte";
	import { useSettingsStore } from "$lib/stores/settings";
	import CopyToClipBoardBtn from "$lib/components/CopyToClipBoardBtn.svelte";
	import CarbonArrowUpRight from "~icons/carbon/arrow-up-right";
	import CarbonCopy from "~icons/carbon/copy";
	import IconNew from "$lib/components/icons/IconNew.svelte";
	import CarbonCode from "~icons/carbon/code";

	import { goto } from "$app/navigation";
	import { usePublicConfig } from "$lib/utils/PublicConfig.svelte";
	import Switch from "$lib/components/Switch.svelte";
	import { PROVIDERS_HUB_ORGS } from "@huggingface/inference";

	const publicConfig = usePublicConfig();
	const settings = useSettingsStore();

	type RouterProvider = { provider: string } & Record<string, unknown>;

	$effect(() => {
		const defaultPreprompt =
			page.data.models.find((el: BackendModel) => el.id === page.params.model)?.preprompt || "";
		settings.initValue("customPrompts", page.params.model, defaultPreprompt);
	});

	let hasCustomPreprompt = $derived(
		$settings.customPrompts[page.params.model] !== undefined &&
			$settings.customPrompts[page.params.model] !== "" &&
			$settings.customPrompts[page.params.model] !==
				page.data.models.find((el: BackendModel) => el.id === page.params.model)?.preprompt
	);

	let model = $derived(page.data.models.find((el: BackendModel) => el.id === page.params.model));
	let providerList: RouterProvider[] = $derived((model?.providers ?? []) as RouterProvider[]);

	// Initialize multimodal override for this model if not set yet
	$effect(() => {
		if (model) {
			// Default to the model's advertised capability
			settings.initValue("multimodalOverrides", page.params.model, !!model.multimodal);
		}
	});

	// Ensure hidePromptExamples has an entry for this model so the switch can bind safely
	$effect(() => {
		settings.initValue("hidePromptExamples", page.params.model, false);
	});

	let modelId = $derived(page.params.model);

	// Track whether model parameters details is expanded per model
	let parametersExpanded = $state(false);

	type ParameterKey = keyof ModelParameterOverrides;

	type ParameterConfig = {
		key: ParameterKey;
		label: string;
		description: string;
		min: number;
		max?: number;
		step: number;
		integer?: boolean;
	};

	const parameterConfigs: ParameterConfig[] = [
		{
			key: "temperature",
			label: "Temperature",
			description: "Controls randomness (low = focused, high = creative)",
			min: 0,
			max: 2,
			step: 0.1,
		},
		{
			key: "max_tokens",
			label: "Max Tokens",
			description: "Maximum number of total generated tokens",
			min: 1,
			step: 1,
			integer: true,
		},
	];

	function hasCustomParameter(param: ParameterKey) {
		const overrides = $settings.modelParameters?.[modelId];
		if (!overrides) return false;

		const userValue = overrides[param];
		const modelDefault = model?.parameters?.[param];
		return userValue !== undefined && userValue !== modelDefault;
	}

	function updateParameter(param: ParameterKey, value: number | undefined) {
		const normalized = value === undefined || Number.isNaN(value) ? undefined : value;
		const currentOverrides = $settings.modelParameters?.[modelId];

		if (normalized === undefined) {
			if (!currentOverrides || currentOverrides[param] === undefined) {
				return;
			}
		} else if (currentOverrides?.[param] === normalized) {
			return;
		}

		settings.update((state) => {
			const overridesInState = state.modelParameters?.[modelId];
			const updatedOverrides: ModelParameterOverrides = { ...(overridesInState ?? {}) };

			if (normalized === undefined) {
				delete updatedOverrides[param];
			} else {
				updatedOverrides[param] = normalized;
			}

			const nextModelParameters = { ...(state.modelParameters ?? {}) };

			if (Object.keys(updatedOverrides).length === 0) {
				delete nextModelParameters[modelId];
			} else {
				nextModelParameters[modelId] = updatedOverrides;
			}

			return {
				...state,
				modelParameters: nextModelParameters,
			};
		});
	}

	function handleParameterInput(param: ParameterKey, rawValue: string, integer = false) {
		const trimmed = rawValue.trim();

		if (trimmed === "") {
			updateParameter(param, undefined);
			return;
		}

		const parsed = integer ? Number.parseInt(trimmed, 10) : Number.parseFloat(trimmed);
		if (Number.isNaN(parsed)) {
			return;
		}

		updateParameter(param, parsed);
	}
</script>

<div class="flex flex-col items-start">
	<div class="mb-4 flex flex-col gap-0.5">
		<h2 class="text-base font-semibold md:text-lg">
			{model.displayName}
		</h2>

		{#if model.description}
			<p class="line-clamp-2 whitespace-pre-wrap text-sm text-gray-600 dark:text-gray-400">
				{model.description}
			</p>
		{/if}
	</div>

	<!-- Actions -->
	<div class="mb-4 flex flex-wrap items-center gap-1.5">
		<button
			class="flex w-fit items-center rounded-full bg-black px-3 py-1.5 text-sm !text-white shadow-sm hover:bg-black/90 dark:bg-white/80 dark:!text-gray-900 dark:hover:bg-white/90"
			name="Activate model"
			onclick={(e) => {
				e.stopPropagation();
				settings.instantSet({
					activeModel: page.params.model,
				});
				goto(`${base}/`);
			}}
		>
			<IconNew classNames="mr-1.5 text-sm" />
			New chat
		</button>

		{#if model.modelUrl}
			<a
				href={model.modelUrl || "https://huggingface.co/" + model.name}
				target="_blank"
				rel="noreferrer"
				class="inline-flex items-center rounded-full border border-gray-200 px-2.5 py-1 text-sm hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700/60"
			>
				<CarbonArrowUpRight class="mr-1.5 shrink-0 text-xs " />
				Model page
			</a>
		{/if}

		{#if model.datasetName || model.datasetUrl}
			<a
				href={model.datasetUrl || "https://huggingface.co/datasets/" + model.datasetName}
				target="_blank"
				rel="noreferrer"
				class="inline-flex items-center rounded-full border border-gray-200 px-2.5 py-1 text-sm hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700/60"
			>
				<CarbonArrowUpRight class="mr-1.5 shrink-0 text-xs " />
				Dataset page
			</a>
		{/if}

		{#if model.websiteUrl}
			<a
				href={model.websiteUrl}
				target="_blank"
				class="inline-flex items-center rounded-full border border-gray-200 px-2.5 py-1 text-sm hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700/60"
				rel="noreferrer"
			>
				<CarbonArrowUpRight class="mr-1.5 shrink-0 text-xs " />
				Model website
			</a>
		{/if}

		{#if publicConfig.isHuggingChat}
			{#if !model?.isRouter}
				<a
					href={"https://huggingface.co/playground?modelId=" + model.name}
					target="_blank"
					rel="noreferrer"
					class="inline-flex items-center rounded-full border border-gray-200 px-2.5 py-1 text-sm hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700/60"
				>
					<CarbonCode class="mr-1.5 shrink-0 text-xs" />
					API Playground
				</a>
				<a
					href={"https://huggingface.co/" + model.name}
					target="_blank"
					rel="noreferrer"
					class="inline-flex items-center rounded-full border border-gray-200 px-2.5 py-1 text-sm hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700/60"
				>
					<CarbonArrowUpRight class="mr-1.5 shrink-0 text-xs" />
					View model card
				</a>
			{/if}
			<CopyToClipBoardBtn
				value="{publicConfig.PUBLIC_ORIGIN || page.url.origin}{base}/models/{model.id}"
				classNames="inline-flex items-center rounded-full border border-gray-200 px-2.5 py-1 text-sm hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700/60"
			>
				<div class="flex items-center gap-1.5">
					<CarbonCopy class="shrink-0 text-xs" />Copy new chat link
				</div>
			</CopyToClipBoardBtn>
		{/if}
	</div>

	<div class="relative flex w-full flex-col gap-2">
		{#if model?.isRouter}
			<p class="mb-3 mt-2 rounded-lg bg-gray-100 px-3 py-2 text-sm dark:bg-white/5">
				<IconOmni classNames="-translate-y-px" /> Omni routes your messages to the best underlying model
				depending on your request.
			</p>
		{/if}
		<div class="flex w-full flex-row content-between">
			<h3 class="mb-1 text-[15px] font-semibold text-gray-800 dark:text-gray-200">System Prompt</h3>
			{#if hasCustomPreprompt}
				<button
					class="ml-auto text-xs underline decoration-gray-300 hover:decoration-gray-700 dark:decoration-gray-700 dark:hover:decoration-gray-400"
					onclick={(e) => {
						e.stopPropagation();
						$settings.customPrompts[page.params.model] = model.preprompt;
					}}
				>
					Reset
				</button>
			{/if}
		</div>

		<textarea
			aria-label="Custom system prompt"
			rows="8"
			class="w-full resize-none rounded-md border border-gray-200 bg-gray-50 p-2 text-[13px] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
			bind:value={$settings.customPrompts[page.params.model]}
		></textarea>

		<!-- Capabilities -->
		<div
			class="mt-3 rounded-xl border border-gray-200 bg-white px-3 shadow-sm dark:border-gray-700 dark:bg-gray-800"
		>
			<div class="divide-y divide-gray-200 dark:divide-gray-700">
				{#if !model?.isRouter}
					<details class="group py-3" bind:open={parametersExpanded}>
						<summary class="flex cursor-pointer list-none items-start justify-between">
							<div>
								<div class="text-[13px] font-medium text-gray-800 dark:text-gray-200">
									Model Parameters
								</div>
								<p class="text-[12px] text-gray-500 dark:text-gray-400">
									Customize generation parameters.
								</p>
							</div>
						</summary>

						<div class="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 sm:gap-3">
							{#each parameterConfigs as config (config.key)}
								<div>
									<div class="mb-1 flex w-full flex-row items-center justify-between">
										<label
											for="{String(config.key)}-{modelId}"
											class="text-[13px] font-medium text-gray-700 dark:text-gray-300"
										>
											{config.label}
										</label>
										{#if hasCustomParameter(config.key)}
											<button
												class="text-xs underline decoration-gray-300 hover:decoration-gray-700 dark:decoration-gray-700 dark:hover:decoration-gray-400"
												onclick={() => updateParameter(config.key, undefined)}
											>
												Reset
											</button>
										{/if}
									</div>
									<input
										id="{String(config.key)}-{modelId}"
										type="number"
										min={config.min}
										max={config.max ?? undefined}
										step={config.step}
										value={$settings.modelParameters?.[modelId]?.[config.key] ?? ""}
										oninput={(e) =>
											handleParameterInput(
												config.key,
												e.currentTarget.value,
												Boolean(config.integer)
											)}
										class="w-full rounded border border-gray-200 px-2 py-1 text-[13px] dark:border-gray-700 dark:bg-gray-900"
									/>
									<p class="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
										{config.description}
									</p>
								</div>
							{/each}
						</div>
					</details>
				{/if}

				<div class="flex items-start justify-between py-3">
					<div>
						<div class="text-[13px] font-medium text-gray-800 dark:text-gray-200">
							Multimodal support (image inputs)
						</div>
						<p class="text-[12px] text-gray-500 dark:text-gray-400">
							Enable image uploads and send images to this model.
						</p>
					</div>
					<Switch
						name="forceMultimodal"
						bind:checked={$settings.multimodalOverrides[page.params.model]}
					/>
				</div>

				{#if model?.isRouter}
					<div class="flex items-start justify-between py-3">
						<div>
							<div class="text-[13px] font-medium text-gray-800 dark:text-gray-200">
								Hide prompt examples
							</div>
							<p class="text-[12px] text-gray-500 dark:text-gray-400">
								Hide the prompt suggestions above the chat input.
							</p>
						</div>
						<Switch
							name="hidePromptExamples"
							bind:checked={$settings.hidePromptExamples[page.params.model]}
						/>
					</div>
				{/if}
			</div>
		</div>

		{#if model.providers?.length}
			<div
				class="mt-3 flex flex-col gap-2.5 rounded-xl border border-gray-200 bg-white px-3 py-2 shadow-sm dark:border-gray-700 dark:bg-gray-800"
			>
				<div>
					<div class="text-[13px] font-medium text-gray-800 dark:text-gray-200">
						Inference Providers
					</div>
					<p class="text-[12px] text-gray-500 dark:text-gray-400">
						Providers serving this model. You can enable/disable some providers from <a
							class="underline decoration-gray-400 hover:decoration-gray-700 dark:decoration-gray-500 dark:hover:decoration-gray-500"
							target="_blank"
							href="https://huggingface.co/settings/inference-providers/settings">your settings</a
						>.
					</p>
				</div>
				<ul class="mb-0.5 flex flex-wrap gap-2">
					{#each providerList as prov, i (prov.provider || i)}
						{@const hubOrg = PROVIDERS_HUB_ORGS[prov.provider as keyof typeof PROVIDERS_HUB_ORGS]}
						<li>
							<span
								class="flex items-center gap-1 rounded-md bg-gray-100 py-0.5 pl-1.5 pr-2 text-xs text-gray-700 dark:bg-gray-700/60 dark:text-gray-200"
							>
								{#if hubOrg}
									<img
										src="https://huggingface.co/api/organizations/{hubOrg}/avatar"
										alt="{prov.provider} logo"
										class="size-2.5 flex-none rounded-sm"
										onerror={(e) => ((e.currentTarget as HTMLImageElement).style.display = "none")}
									/>
								{/if}
								{prov.provider}
							</span>
						</li>
					{/each}
				</ul>
			</div>
		{/if}
		<!-- Tokenizer-based token counting disabled in this build -->
	</div>
</div>
