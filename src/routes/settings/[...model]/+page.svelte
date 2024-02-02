<script lang="ts">
	import { page } from "$app/stores";
	import { base } from "$app/paths";
	import { PUBLIC_ORIGIN } from "$env/static/public";
	import type { BackendModel } from "$lib/server/models";
	import { useSettingsStore } from "$lib/stores/settings";
	import CopyToClipBoardBtn from "$lib/components/CopyToClipBoardBtn.svelte";
	import CarbonArrowUpRight from "~icons/carbon/arrow-up-right";
	import CarbonLink from "~icons/carbon/link";

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

	$: isActive = $settings.activeModel === $page.params.model;

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
			value="{PUBLIC_ORIGIN || $page.url.origin}{base}?model={model.id}"
			classNames="!border-none !shadow-none !py-0 !px-1 !rounded-md"
		>
			<div class="flex items-center gap-1.5 hover:underline">
				<CarbonLink />Copy direct link to model
			</div>
		</CopyToClipBoardBtn>
	</div>

	<button
		class="{isActive
			? 'bg-gray-100'
			: 'bg-black text-white'} my-8 flex items-center rounded-full px-3 py-1"
		disabled={isActive}
		name="Activate model"
		on:click|stopPropagation={() => {
			$settings.activeModel = $page.params.model;
		}}
	>
		{isActive ? "Active model" : "Activate"}
	</button>

	<div class="flex w-full flex-col gap-2">
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
	</div>
</div>
