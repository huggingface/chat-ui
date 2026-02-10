<script lang="ts">
	import { onMount, type Snippet } from "svelte";
	import { base } from "$app/paths";
	import { afterNavigate, goto } from "$app/navigation";
	import { page } from "$app/state";
	import { useSettingsStore } from "$lib/stores/settings";
	import IconOmni from "$lib/components/icons/IconOmni.svelte";
	import IconFast from "$lib/components/icons/IconFast.svelte";
	import IconCheap from "$lib/components/icons/IconCheap.svelte";
	import CarbonClose from "~icons/carbon/close";
	import CarbonTextLongParagraph from "~icons/carbon/text-long-paragraph";
	import CarbonChevronLeft from "~icons/carbon/chevron-left";
	import CarbonSearch from "~icons/carbon/search";
	import LucideImage from "~icons/lucide/image";
	import LucideHammer from "~icons/lucide/hammer";
	import IconGear from "~icons/bi/gear-fill";
	import { PROVIDERS_HUB_ORGS } from "@huggingface/inference";
	import { usePublicConfig } from "$lib/utils/PublicConfig.svelte";
	import { browser } from "$app/environment";
	import { isDesktop } from "$lib/utils/isDesktop";
	import IconBurger from "$lib/components/icons/IconBurger.svelte";

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

	// Search state
	let modelFilter = $state("");
	let searchFocused = $state(false);
	const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ");
	let queryTokens = $derived(normalize(modelFilter).trim().split(/\s+/).filter(Boolean));

	let filteredModels = $derived(
		data.models
			.filter((el) => !el.unlisted)
			.filter((el) => {
				const haystack = normalize(`${el.id} ${el.name ?? ""} ${el.displayName ?? ""}`);
				return queryTokens.every((q) => haystack.includes(q));
			})
	);

	// Breadcrumb for current view
	let currentModelName = $derived(data.models.find((m) => m.id === page.params.model)?.displayName);
	let isOnApplication = $derived(page.url.pathname.endsWith("/application"));

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

<div
	class="mx-auto flex h-full w-full max-w-[1400px] flex-col overflow-hidden p-4 text-gray-800 dark:text-gray-300"
>
	<!-- Top Bar: Search + Breadcrumb + Close -->
	<div class="mb-3 flex items-center gap-3">
		{#if showContent && browser && !isDesktop(window)}
			<button
				class="btn flex-none rounded-lg"
				aria-label="Back to menu"
				onclick={() => {
					showContent = false;
					goto(`${base}/settings`);
				}}
			>
				<IconBurger classNames="text-xl text-gray-900 dark:text-gray-200 sm:hidden" />
				<CarbonChevronLeft class="text-xl text-gray-900 dark:text-gray-200 max-sm:hidden" />
			</button>
		{/if}

		<!-- Search Bar - Full width, prominent -->
		<div class="relative flex-1 max-md:hidden">
			<CarbonSearch class="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-gray-400" />
			<input
				bind:value={modelFilter}
				onfocus={() => (searchFocused = true)}
				onblur={() => setTimeout(() => (searchFocused = false), 200)}
				type="search"
				placeholder="Search models..."
				aria-label="Search models"
				class="w-full rounded-xl border border-gray-200 bg-gray-50 py-2 pl-9 pr-4 text-sm placeholder:text-gray-400 focus:border-blue-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-200 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:placeholder:text-gray-500 dark:focus:border-blue-500/50 dark:focus:ring-blue-500/20"
			/>
			<!-- Search results dropdown -->
			{#if searchFocused && modelFilter.length > 0}
				<div
					class="absolute top-full z-50 mt-1 w-full rounded-xl border border-gray-200 bg-white/95 p-1 shadow-lg backdrop-blur dark:border-gray-700 dark:bg-gray-800/95"
				>
					<div class="scrollbar-custom max-h-64 overflow-y-auto">
						{#each filteredModels.slice(0, 8) as model (model.id)}
							<button
								type="button"
								onmousedown={() => {
									goto(`${base}/settings/${model.id}`);
									modelFilter = "";
								}}
								class="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700/60"
							>
								<span class="truncate font-medium">{model.displayName}</span>
								{#if model.isRouter}
									<IconOmni />
								{/if}
								{#if model.id === $settings.activeModel}
									<span
										class="ml-auto rounded bg-black/90 px-1.5 py-0.5 text-[10px] font-semibold text-white dark:bg-white dark:text-black"
										>Active</span
									>
								{/if}
							</button>
						{/each}
						{#if filteredModels.length === 0}
							<div class="px-3 py-2 text-sm text-gray-500">No models found</div>
						{/if}
					</div>
				</div>
			{/if}
		</div>

		<!-- Breadcrumb (desktop) -->
		<div class="hidden items-center gap-1.5 text-sm text-gray-500 md:flex">
			<span>Settings</span>
			{#if isOnApplication}
				<CarbonChevronLeft class="size-3 rotate-180" />
				<span class="font-medium text-gray-800 dark:text-gray-200">General</span>
			{:else if currentModelName}
				<CarbonChevronLeft class="size-3 rotate-180" />
				<span class="font-medium text-gray-800 dark:text-gray-200">{currentModelName}</span>
			{/if}
		</div>

		<!-- Mobile title -->
		<h2 class="flex-1 text-center text-lg font-bold md:hidden">Settings</h2>

		<button
			class="btn flex-none rounded-lg"
			aria-label="Close settings"
			onclick={() => goto(previousPage)}
		>
			<CarbonClose
				class="text-xl text-gray-900 hover:text-black dark:text-gray-200 dark:hover:text-white"
			/>
		</button>
	</div>

	<!-- Main Area -->
	<div class="flex min-h-0 flex-1 gap-0 overflow-hidden md:gap-4">
		<!-- Narrow sidebar with icons + condensed list -->
		{#if !(showContent && browser && !isDesktop(window))}
			<div
				class="scrollbar-custom flex w-48 flex-none flex-col overflow-y-auto max-md:-mx-4 max-md:w-full md:w-52"
			>
				<!-- App Settings Link -->
				<button
					type="button"
					onclick={() => {
						goto(`${base}/settings/application`);
						showContent = true;
					}}
					class="group mb-1 flex h-8 w-full flex-none items-center gap-2 rounded-lg px-2.5 text-[13px] font-medium
						{isOnApplication
						? 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200'
						: 'text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800/60'}"
				>
					<IconGear class="flex-none text-xs" />
					General
				</button>

				<div class="my-1 h-px bg-gray-200 dark:bg-gray-700"></div>

				<!-- Mobile search -->
				<div class="px-2 py-1.5 md:hidden">
					<input
						bind:value={modelFilter}
						type="search"
						placeholder="Search..."
						class="w-full rounded-lg border border-gray-300 bg-white px-3 py-1 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
					/>
				</div>

				<!-- Condensed model list with inline capability dots -->
				{#each filteredModels as model (model.id)}
					{@const isSelected = model.id === page.params.model}
					{@const isActive = model.id === $settings.activeModel}
					{@const hasTools =
						$settings.toolsOverrides?.[model.id] ??
						(model as { supportsTools?: boolean }).supportsTools}
					{@const hasVision = $settings.multimodalOverrides?.[model.id] ?? model.multimodal}
					<button
						type="button"
						onclick={() => {
							goto(`${base}/settings/${model.id}`);
							showContent = true;
						}}
						class="group flex h-8 w-full items-center gap-1.5 rounded-lg px-2.5 text-[12px]
							{isSelected
							? 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200'
							: 'text-gray-600 hover:bg-gray-50 dark:text-gray-400 dark:hover:bg-gray-800/60'}"
					>
						<!-- Capability dots -->
						<span class="flex flex-none gap-0.5">
							{#if model.isRouter}
								<span class="size-1.5 rounded-full bg-yellow-500" title="Router"></span>
							{/if}
							{#if hasTools}
								<span class="size-1.5 rounded-full bg-purple-500" title="Tools"></span>
							{/if}
							{#if hasVision}
								<span class="size-1.5 rounded-full bg-blue-500" title="Vision"></span>
							{/if}
						</span>
						<span class="truncate">{model.displayName}</span>
						{#if isActive}
							<span
								class="ml-auto flex-none rounded bg-black px-1 py-0.5 text-[9px] font-bold leading-none text-white dark:bg-white dark:text-black"
							>
								ACT
							</span>
						{/if}
					</button>
				{/each}
			</div>
		{/if}

		<!-- Content -->
		{#if showContent}
			<div
				class="scrollbar-custom min-h-0 flex-1 overflow-y-auto overflow-x-clip px-1 md:border-l md:border-gray-200 md:pl-4 md:dark:border-gray-700"
			>
				{@render children?.()}
			</div>
		{/if}
	</div>
</div>
