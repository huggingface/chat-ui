<script lang="ts">
	import { page } from "$app/state";
	import { base } from "$app/paths";

	import type { BackendModel } from "$lib/server/models";
	import IconOmni from "$lib/components/icons/IconOmni.svelte";
	import { useSettingsStore } from "$lib/stores/settings";
	import CopyToClipBoardBtn from "$lib/components/CopyToClipBoardBtn.svelte";
	import CarbonArrowUpRight from "~icons/carbon/arrow-up-right";
	import CarbonCopy from "~icons/carbon/copy";
	import CarbonChat from "~icons/carbon/chat";
	import CarbonCode from "~icons/carbon/code";

	import { goto } from "$app/navigation";
	import { usePublicConfig } from "$lib/utils/PublicConfig.svelte";
	import Switch from "$lib/components/Switch.svelte";

	const publicConfig = usePublicConfig();
	const settings = useSettingsStore();

	type RouterProvider = { provider: string } & Record<string, unknown>;

	$effect(() => {
		if ($settings.customPrompts[page.params.model] === undefined) {
			$settings.customPrompts = {
				...$settings.customPrompts,
				[page.params.model]:
					page.data.models.find((el: BackendModel) => el.id === page.params.model)?.preprompt || "",
			};
		}
	});

	let hasCustomPreprompt = $derived(
		$settings.customPrompts[page.params.model] !==
			page.data.models.find((el: BackendModel) => el.id === page.params.model)?.preprompt
	);

	let model = $derived(page.data.models.find((el: BackendModel) => el.id === page.params.model));
	let providerList: RouterProvider[] = $derived((model?.providers ?? []) as RouterProvider[]);

	// Initialize multimodal override for this model if not set yet
	$effect(() => {
		if (!$settings.multimodalOverrides) {
			$settings.multimodalOverrides = {};
		}
		const modelId = page.params.model;
		if ($settings.multimodalOverrides[modelId] === undefined && model) {
			// Default to the model's advertised capability
			$settings.multimodalOverrides = {
				...$settings.multimodalOverrides,
				[modelId]: !!model.multimodal,
			};
		}
	});

	// Ensure hidePromptExamples has an entry for this model so the switch can bind safely
	$effect(() => {
		if (!$settings.hidePromptExamples) {
			$settings.hidePromptExamples = {};
		}
		const modelId = page.params.model;
		if ($settings.hidePromptExamples[modelId] === undefined) {
			$settings.hidePromptExamples = {
				...$settings.hidePromptExamples,
				[modelId]: false,
			};
		}
	});
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
			<CarbonChat class="mr-1.5 text-sm" />
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
				<div class="flex items-start justify-between py-3">
					<div>
						<div class="text-[13px] font-medium text-gray-800 dark:text-gray-200">
							Supports image inputs (multimodal)
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
						Providers serving this model
					</div>
					<p class="text-[12px] text-gray-500 dark:text-gray-400">
						Your requests for this model will be routed through one of the available providers.
					</p>
				</div>
				<ul class="mb-0.5 flex flex-wrap gap-2">
					{#each providerList as prov, i (prov.provider || i)}
						<li>
							<span
								class="flex items-center gap-1 rounded-md bg-gray-100 py-0.5 pl-1.5 pr-2 text-xs text-gray-700 dark:bg-gray-700/60 dark:text-gray-200"
							>
								{#if prov.provider}
									<img
										class="h-[14px] w-auto"
										src={`${base}/huggingchat/providers/${prov.provider}.svg`}
										alt="{prov.provider} logo"
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
