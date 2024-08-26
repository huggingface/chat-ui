<script lang="ts">
	import { page } from "$app/stores";
	import { base } from "$app/paths";
	import { env as envPublic } from "$env/dynamic/public";
	import type { BackendModel } from "$lib/server/models";
	import { useSettingsStore } from "$lib/stores/settings";
	import CopyToClipBoardBtn from "$lib/components/CopyToClipBoardBtn.svelte";
	import TokensCounter from "$lib/components/TokensCounter.svelte";
	import CarbonArrowUpRight from "~icons/carbon/arrow-up-right";
	import CarbonLink from "~icons/carbon/link";
	import CarbonChat from "~icons/carbon/chat";

	import { goto } from "$app/navigation";

	const settings = useSettingsStore();

	$: if ($settings.customPrompts[$page.params.model] === undefined) {
		$settings.customPrompts = {
			...$settings.customPrompts,
			[$page.params.model]:
				$page.data.models.find((el: BackendModel) => el.id === $page.params.model)?.preprompt || "",
		};
	}

	$: hasCustomPreprompt =
		$settings.customPrompts[$page.params.model] !==
		$page.data.models.find((el: BackendModel) => el.id === $page.params.model)?.preprompt;

	$: model = $page.data.models.find((el: BackendModel) => el.id === $page.params.model);
</script>

<div class="flex flex-col items-start">
	<div class="mb-5 flex flex-col gap-1.5">
		<h2 class="text-lg font-semibold md:text-xl">
			{$page.params.model}
		</h2>

		{#if model.description}
			<p class="whitespace-pre-wrap text-gray-600">
				{model.description}
			</p>
		{/if}
	</div>

	<div class="flex flex-wrap items-center gap-2 md:gap-4">
		{#if model.modelUrl}
			<a
				href={model.modelUrl || "https://huggingface.co/" + model.name}
				target="_blank"
				rel="noreferrer"
				class="flex items-center truncate underline underline-offset-2"
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
				class="flex items-center truncate underline underline-offset-2"
			>
				<CarbonArrowUpRight class="mr-1.5 shrink-0 text-xs " />
				Dataset page
			</a>
		{/if}

		{#if model.websiteUrl}
			<a
				href={model.websiteUrl}
				target="_blank"
				class="flex items-center truncate underline underline-offset-2"
				rel="noreferrer"
			>
				<CarbonArrowUpRight class="mr-1.5 shrink-0 text-xs " />
				Model website
			</a>
		{/if}
		<CopyToClipBoardBtn
			value="{envPublic.PUBLIC_ORIGIN || $page.url.origin}{base}/models/{model.id}"
			classNames="!border-none !shadow-none !py-0 !px-1 !rounded-md"
		>
			<div class="flex items-center gap-1.5 hover:underline">
				<CarbonLink />Copy direct link to model
			</div>
		</CopyToClipBoardBtn>
	</div>

	<button
		class="my-2 flex w-fit items-center rounded-full bg-black px-3 py-1 text-base !text-white"
		name="Activate model"
		on:click|stopPropagation={() => {
			settings.instantSet({
				activeModel: $page.params.model,
			});
			goto(`${base}/`);
		}}
	>
		<CarbonChat class="mr-1.5 text-sm" />
		New chat
	</button>

	<div class="relative flex w-full flex-col gap-2">
		<div class="flex w-full flex-row content-between">
			<h3 class="mb-1.5 text-lg font-semibold text-gray-800">System Prompt</h3>
			{#if hasCustomPreprompt}
				<button
					class="ml-auto underline decoration-gray-300 hover:decoration-gray-700"
					on:click|stopPropagation={() =>
						($settings.customPrompts[$page.params.model] = model.preprompt)}
				>
					Reset
				</button>
			{/if}
		</div>
		<textarea
			rows="10"
			class="w-full resize-none rounded-md border-2 bg-gray-100 p-2"
			bind:value={$settings.customPrompts[$page.params.model]}
		/>
		{#if model.tokenizer && $settings.customPrompts[$page.params.model]}
			<TokensCounter
				classNames="absolute bottom-2 right-2"
				prompt={$settings.customPrompts[$page.params.model]}
				modelTokenizer={model.tokenizer}
				truncate={model?.parameters?.truncate}
			/>
		{/if}
	</div>
</div>
