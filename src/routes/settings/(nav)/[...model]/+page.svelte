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
	import { PROVIDERS_HUB_ORGS } from "@huggingface/inference";

	const publicConfig = usePublicConfig();
	const settings = useSettingsStore();

	// Functional bindings for nested settings (Svelte 5):
	// Avoid binding directly to $settings.*[modelId]; write via store update
	function getToolsOverride() {
		return $settings.toolsOverrides?.[page.params.model] ?? false;
	}
	function setToolsOverride(v: boolean) {
		settings.update((s) => ({
			...s,
			toolsOverrides: { ...s.toolsOverrides, [page.params.model]: v },
		}));
	}
	function getMultimodalOverride() {
		return $settings.multimodalOverrides?.[page.params.model] ?? false;
	}
	function setMultimodalOverride(v: boolean) {
		settings.update((s) => ({
			...s,
			multimodalOverrides: { ...s.multimodalOverrides, [page.params.model]: v },
		}));
	}
	function getHidePromptExamples() {
		return $settings.hidePromptExamples?.[page.params.model] ?? false;
	}
	function setHidePromptExamples(v: boolean) {
		settings.update((s) => ({
			...s,
			hidePromptExamples: { ...s.hidePromptExamples, [page.params.model]: v },
		}));
	}

	function getCustomPrompt() {
		return $settings.customPrompts?.[page.params.model] ?? "";
	}
	function setCustomPrompt(v: string) {
		settings.update((s) => ({
			...s,
			customPrompts: { ...s.customPrompts, [page.params.model]: v },
		}));
	}

	type RouterProvider = { provider: string } & Record<string, unknown>;

	$effect(() => {
		const defaultPreprompt =
			page.data.models.find((el: BackendModel) => el.id === page.params.model)?.preprompt || "";
		settings.initValue("customPrompts", page.params.model, defaultPreprompt);
	});

	let hasCustomPreprompt = $derived(
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

	// Initialize tools override for this model if not set yet
	$effect(() => {
		if (model) {
			settings.initValue(
				"toolsOverrides",
				page.params.model,
				Boolean((model as unknown as { supportsTools?: boolean }).supportsTools)
			);
		}
	});

	// Ensure hidePromptExamples has an entry for this model so the switch can bind safely
	$effect(() => {
		settings.initValue("hidePromptExamples", page.params.model, false);
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
					<CarbonCopy class="shrink-0 text-xs" />Copy direct link
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
						settings.update((s) => ({
							...s,
							customPrompts: { ...s.customPrompts, [page.params.model]: model.preprompt },
						}));
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
			bind:value={getCustomPrompt, setCustomPrompt}
		></textarea>
		<!-- Capabilities -->
		<div
			class="mt-3 rounded-xl border border-gray-200 bg-white px-3 shadow-sm dark:border-gray-700 dark:bg-gray-800"
		>
			<div class="divide-y divide-gray-200 dark:divide-gray-700">
				<div class="flex items-start justify-between py-3">
					<div>
						<div class="text-[13px] font-medium text-gray-800 dark:text-gray-200">
							Tool calling (functions)
						</div>
						<p class="text-[12px] text-gray-500 dark:text-gray-400">
							Enable tools and allow the model to call them in chat.
						</p>
					</div>
					<Switch name="forceTools" bind:checked={getToolsOverride, setToolsOverride} />
				</div>

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
						bind:checked={getMultimodalOverride, setMultimodalOverride}
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
							bind:checked={getHidePromptExamples, setHidePromptExamples}
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
										src="https://huggingface.co/api/avatars/{hubOrg}"
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
