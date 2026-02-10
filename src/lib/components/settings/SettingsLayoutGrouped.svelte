<script lang="ts">
	import { onMount, tick, type Snippet } from "svelte";
	import { base } from "$app/paths";
	import { afterNavigate, goto } from "$app/navigation";
	import { page } from "$app/state";
	import { useSettingsStore } from "$lib/stores/settings";
	import IconOmni from "$lib/components/icons/IconOmni.svelte";
	import IconBurger from "$lib/components/icons/IconBurger.svelte";
	import IconFast from "$lib/components/icons/IconFast.svelte";
	import IconCheap from "$lib/components/icons/IconCheap.svelte";
	import CarbonClose from "~icons/carbon/close";
	import CarbonTextLongParagraph from "~icons/carbon/text-long-paragraph";
	import CarbonChevronLeft from "~icons/carbon/chevron-left";
	import CarbonChevronDown from "~icons/carbon/chevron-down";
	import CarbonChevronRight from "~icons/carbon/chevron-right";
	import LucideImage from "~icons/lucide/image";
	import LucideHammer from "~icons/lucide/hammer";
	import IconGear from "~icons/bi/gear-fill";
	import { PROVIDERS_HUB_ORGS } from "@huggingface/inference";
	import { usePublicConfig } from "$lib/utils/PublicConfig.svelte";
	import { browser } from "$app/environment";
	import { isDesktop } from "$lib/utils/isDesktop";

	import type { LayoutData } from "../../../routes/settings/$types";

	interface Props {
		data: LayoutData;
		children?: Snippet;
		previousPage: string;
	}

	let { data, children, previousPage }: Props = $props();

	const publicConfig = usePublicConfig();
	const settings = useSettingsStore();

	let showContent: boolean = $state(false);

	// Collapsible sections
	let routerModelsOpen = $state(true);
	let standardModelsOpen = $state(true);

	// Local filter for model list
	let modelFilter = $state("");
	const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ");
	let queryTokens = $derived(normalize(modelFilter).trim().split(/\s+/).filter(Boolean));

	let visibleModels = $derived(
		data.models
			.filter((el) => !el.unlisted)
			.filter((el) => {
				const haystack = normalize(`${el.id} ${el.name ?? ""} ${el.displayName ?? ""}`);
				return queryTokens.every((q) => haystack.includes(q));
			})
	);

	let activeModel = $derived(visibleModels.find((m) => m.id === $settings.activeModel));
	let routerModels = $derived(visibleModels.filter((m) => m.isRouter));
	let standardModels = $derived(visibleModels.filter((m) => !m.isRouter));

	onMount(() => {
		showContent = page.url.pathname !== `${base}/settings`;
		if (browser && isDesktop(window) && page.url.pathname === `${base}/settings`) {
			goto(`${base}/settings/application`);
		}
	});

	afterNavigate(() => {
		showContent = page.url.pathname !== `${base}/settings`;
	});
</script>

{#snippet modelButton(model: (typeof data.models)[0])}
	{@const isSelected = model.id === page.params.model}
	<button
		type="button"
		onclick={() => {
			goto(`${base}/settings/${model.id}`);
			showContent = true;
		}}
		class="group flex h-9 w-full flex-none items-center gap-1.5 rounded-lg px-3 text-[13px] text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800/60
			{isSelected ? '!bg-gray-100 !text-gray-800 dark:!bg-gray-700 dark:!text-gray-200' : ''}"
	>
		<span class="mr-auto truncate">{model.displayName}</span>

		{#if publicConfig.isHuggingChat && !model.isRouter && $settings.providerOverrides?.[model.id] && $settings.providerOverrides[model.id] !== "auto"}
			{@const providerOverride = $settings.providerOverrides[model.id]}
			{@const hubOrg = PROVIDERS_HUB_ORGS[providerOverride as keyof typeof PROVIDERS_HUB_ORGS]}
			{#if providerOverride === "fastest"}
				<span
					class="grid size-[21px] flex-none place-items-center rounded-md bg-green-500/10 text-green-600 dark:text-green-500"
					title="Fastest"
				>
					<IconFast classNames="size-3" />
				</span>
			{:else if providerOverride === "cheapest"}
				<span
					class="grid size-[21px] flex-none place-items-center rounded-md bg-blue-500/10 text-blue-600 dark:text-blue-500"
					title="Cheapest"
				>
					<IconCheap classNames="size-3" />
				</span>
			{:else if hubOrg}
				<span
					class="flex size-[21px] flex-none items-center justify-center rounded-md bg-gray-500/10 p-[0.225rem]"
					title="Provider: {providerOverride}"
				>
					<img
						src="https://huggingface.co/api/avatars/{hubOrg}"
						alt={providerOverride}
						class="size-full rounded"
					/>
				</span>
			{/if}
		{/if}

		{#if $settings.toolsOverrides?.[model.id] ?? (model as { supportsTools?: boolean }).supportsTools}
			<span
				class="grid size-[21px] flex-none place-items-center rounded-md bg-purple-500/10 text-purple-600 dark:text-purple-500"
				title="Tools"
			>
				<LucideHammer class="size-3" />
			</span>
		{/if}

		{#if $settings.multimodalOverrides?.[model.id] ?? model.multimodal}
			<span
				class="grid size-[21px] flex-none place-items-center rounded-md bg-blue-500/10 text-blue-600 dark:text-blue-500"
				title="Multimodal"
			>
				<LucideImage class="size-3" />
			</span>
		{/if}

		{#if $settings.customPrompts?.[model.id]}
			<CarbonTextLongParagraph
				class="size-6 flex-none rounded-md border border-gray-300 p-1 text-gray-800 dark:border-gray-600 dark:text-gray-200"
			/>
		{/if}
	</button>
{/snippet}

<div
	class="mx-auto grid h-full w-full max-w-[1400px] grid-cols-1 grid-rows-[auto,1fr] content-start gap-x-6 overflow-hidden p-4 text-gray-800 dark:text-gray-300 md:grid-cols-3 md:grid-rows-[auto,1fr] md:p-4"
>
	<!-- Header -->
	<div class="col-span-1 mb-3 flex items-center justify-between md:col-span-3 md:mb-4">
		{#if showContent && browser}
			<button
				class="btn rounded-lg md:hidden"
				aria-label="Back to menu"
				onclick={() => {
					showContent = false;
					goto(`${base}/settings`);
				}}
			>
				<IconBurger
					classNames="text-xl text-gray-900 hover:text-black dark:text-gray-200 dark:hover:text-white sm:hidden"
				/>
				<CarbonChevronLeft
					class="text-xl text-gray-900 hover:text-black dark:text-gray-200 dark:hover:text-white max-sm:hidden"
				/>
			</button>
		{/if}
		<h2 class="left-0 right-0 mx-auto w-fit text-center text-xl font-bold md:hidden">Settings</h2>
		<button class="btn rounded-lg" aria-label="Close settings" onclick={() => goto(previousPage)}>
			<CarbonClose
				class="text-xl text-gray-900 hover:text-black dark:text-gray-200 dark:hover:text-white"
			/>
		</button>
	</div>

	{#if !(showContent && browser && !isDesktop(window))}
		<div
			class="scrollbar-custom col-span-1 flex flex-col gap-0.5 overflow-y-auto whitespace-nowrap rounded-r-xl bg-gradient-to-l from-gray-50 to-10% dark:from-gray-700/40 max-md:-mx-4 max-md:h-full md:pr-6"
		>
			<!-- Application Settings - Prominent at top -->
			<button
				type="button"
				onclick={() => {
					goto(`${base}/settings/application`);
					showContent = true;
				}}
				class="group flex h-10 w-full flex-none items-center gap-2 rounded-lg px-3 text-[13px] font-medium
					{page.url.pathname === `${base}/settings/application`
					? 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200'
					: 'text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800/60'}"
			>
				<IconGear class="text-sm" />
				General Settings
			</button>

			<div class="my-1.5 h-px bg-gray-200 dark:bg-gray-700"></div>

			<!-- Active Model - Pinned -->
			{#if activeModel}
				<div class="px-3 pb-1 pt-1">
					<span
						class="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500"
					>
						Active Model
					</span>
				</div>
				<div
					class="mb-1 rounded-lg border border-gray-200 bg-white/50 dark:border-gray-600/50 dark:bg-gray-800/50"
				>
					{@render modelButton(activeModel)}
				</div>
				<div class="my-1.5 h-px bg-gray-200 dark:bg-gray-700"></div>
			{/if}

			<!-- Search -->
			<div class="px-2 py-1.5">
				<input
					bind:value={modelFilter}
					type="search"
					placeholder="Search models..."
					aria-label="Search models"
					class="w-full rounded-full border border-gray-300 bg-white px-4 py-1 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-300 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:placeholder:text-gray-500 dark:focus:ring-gray-700"
				/>
			</div>

			<!-- Router Models Group -->
			{#if routerModels.length > 0}
				<button
					type="button"
					class="flex items-center gap-1 px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-400"
					onclick={() => (routerModelsOpen = !routerModelsOpen)}
				>
					{#if routerModelsOpen}
						<CarbonChevronDown class="size-3" />
					{:else}
						<CarbonChevronRight class="size-3" />
					{/if}
					Smart Router
					<span class="ml-auto text-[10px] font-normal text-gray-400">({routerModels.length})</span>
				</button>
				{#if routerModelsOpen}
					{#each routerModels as model (model.id)}
						{@render modelButton(model)}
					{/each}
				{/if}
			{/if}

			<!-- Standard Models Group -->
			{#if standardModels.length > 0}
				<button
					type="button"
					class="flex items-center gap-1 px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-400"
					onclick={() => (standardModelsOpen = !standardModelsOpen)}
				>
					{#if standardModelsOpen}
						<CarbonChevronDown class="size-3" />
					{:else}
						<CarbonChevronRight class="size-3" />
					{/if}
					Models
					<span class="ml-auto text-[10px] font-normal text-gray-400"
						>({standardModels.length})</span
					>
				</button>
				{#if standardModelsOpen}
					{#each standardModels as model (model.id)}
						{@render modelButton(model)}
					{/each}
				{/if}
			{/if}
		</div>
	{/if}

	{#if showContent}
		<div
			class="scrollbar-custom col-span-1 w-full overflow-y-auto overflow-x-clip px-1 md:col-span-2 md:row-span-2"
		>
			{@render children?.()}
		</div>
	{/if}
</div>
