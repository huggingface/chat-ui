<script lang="ts">
	import { onMount, tick, type Snippet } from "svelte";
	import { base } from "$app/paths";
	import { afterNavigate, goto } from "$app/navigation";
	import { page } from "$app/state";
	import { useSettingsStore } from "$lib/stores/settings";
	import IconOmni from "$lib/components/icons/IconOmni.svelte";
	import IconFast from "$lib/components/icons/IconFast.svelte";
	import IconCheap from "$lib/components/icons/IconCheap.svelte";
	import CarbonClose from "~icons/carbon/close";
	import CarbonTextLongParagraph from "~icons/carbon/text-long-paragraph";
	import LucideImage from "~icons/lucide/image";
	import LucideHammer from "~icons/lucide/hammer";
	import IconGear from "~icons/bi/gear-fill";
	import CarbonChat from "~icons/carbon/chat";
	import { PROVIDERS_HUB_ORGS } from "@huggingface/inference";
	import { usePublicConfig } from "$lib/utils/PublicConfig.svelte";
	import { browser } from "$app/environment";

	import type { LayoutData } from "../../../routes/settings/$types";

	interface Props {
		data: LayoutData;
		children?: Snippet;
		previousPage: string;
	}

	let { data, children, previousPage }: Props = $props();

	const publicConfig = usePublicConfig();
	const settings = useSettingsStore();

	// Determine active tab from URL
	let activeTab = $derived(
		page.url.pathname.endsWith("/application") || page.url.pathname === `${base}/settings`
			? "application"
			: "models"
	);

	// Local filter for model list
	let modelFilter = $state("");
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

	// On desktop, if at root settings, redirect to application
	onMount(() => {
		if (
			browser &&
			page.url.pathname === `${base}/settings` &&
			!page.url.pathname.endsWith("/application")
		) {
			goto(`${base}/settings/application`);
		}
	});
</script>

<div
	class="mx-auto flex h-full w-full max-w-[1400px] flex-col overflow-hidden p-4 text-gray-800 dark:text-gray-300"
>
	<!-- Header -->
	<div class="mb-3 flex items-center justify-between">
		<h2 class="text-xl font-bold">Settings</h2>
		<button class="btn rounded-lg" aria-label="Close settings" onclick={() => goto(previousPage)}>
			<CarbonClose
				class="text-xl text-gray-900 hover:text-black dark:text-gray-200 dark:hover:text-white"
			/>
		</button>
	</div>

	<!-- Tab Bar -->
	<div class="mb-4 flex gap-1 rounded-xl bg-gray-100 p-1 dark:bg-gray-700/60">
		<button
			class="flex-1 rounded-lg px-4 py-2 text-sm font-medium transition-all {activeTab ===
			'application'
				? 'bg-white text-gray-900 shadow-sm dark:bg-gray-600 dark:text-white'
				: 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'}"
			onclick={() => goto(`${base}/settings/application`)}
		>
			<IconGear class="mr-1.5 inline -translate-y-px text-xs" />
			General
		</button>
		<button
			class="flex-1 rounded-lg px-4 py-2 text-sm font-medium transition-all {activeTab === 'models'
				? 'bg-white text-gray-900 shadow-sm dark:bg-gray-600 dark:text-white'
				: 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'}"
			onclick={() => {
				// If we're on application, go to first model or stay on current model page
				if (activeTab !== "models") {
					const activeModel = $settings.activeModel;
					const target = activeModel || data.models.find((m) => !m.unlisted)?.id;
					if (target) goto(`${base}/settings/${target}`);
				}
			}}
		>
			<CarbonChat class="mr-1.5 inline -translate-y-px text-xs" />
			Models
		</button>
	</div>

	<!-- Content Area -->
	<div class="flex min-h-0 flex-1 gap-4 overflow-hidden">
		{#if activeTab === "models"}
			<!-- Model Grid Sidebar -->
			<div
				class="scrollbar-custom flex w-56 flex-none flex-col gap-2 overflow-y-auto pr-2 max-md:w-44"
			>
				<!-- Search -->
				<input
					bind:value={modelFilter}
					type="search"
					placeholder="Filter models..."
					aria-label="Search models"
					class="sticky top-0 z-10 w-full rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:placeholder:text-gray-500"
				/>

				<!-- Model Cards -->
				{#each filteredModels as model (model.id)}
					{@const isSelected = model.id === page.params.model}
					{@const isActive = model.id === $settings.activeModel}
					<button
						type="button"
						onclick={() => goto(`${base}/settings/${model.id}`)}
						class="group flex flex-col gap-1 rounded-xl border p-2.5 text-left transition-all
							{isSelected
							? 'border-blue-400 bg-blue-50 dark:border-blue-500/50 dark:bg-blue-500/10'
							: 'border-gray-200 bg-white hover:border-gray-300 hover:shadow-sm dark:border-gray-700 dark:bg-gray-800 dark:hover:border-gray-600'}"
					>
						<div class="flex items-center gap-1">
							<span class="truncate text-[13px] font-medium text-gray-800 dark:text-gray-200">
								{model.displayName}
							</span>
							{#if model.isRouter}
								<IconOmni />
							{/if}
						</div>
						<div class="flex flex-wrap gap-1">
							{#if isActive}
								<span
									class="rounded bg-black/90 px-1.5 py-0.5 text-[10px] font-semibold text-white dark:bg-white dark:text-black"
								>
									Active
								</span>
							{/if}
							{#if $settings.toolsOverrides?.[model.id] ?? (model as { supportsTools?: boolean }).supportsTools}
								<span
									class="rounded bg-purple-100 px-1.5 py-0.5 text-[10px] text-purple-700 dark:bg-purple-500/20 dark:text-purple-400"
								>
									Tools
								</span>
							{/if}
							{#if $settings.multimodalOverrides?.[model.id] ?? model.multimodal}
								<span
									class="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] text-blue-700 dark:bg-blue-500/20 dark:text-blue-400"
								>
									Vision
								</span>
							{/if}
							{#if $settings.customPrompts?.[model.id]}
								<span
									class="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-600 dark:bg-gray-600 dark:text-gray-300"
								>
									Custom
								</span>
							{/if}
						</div>
					</button>
				{/each}
			</div>
		{/if}

		<!-- Main Content -->
		<div class="scrollbar-custom min-h-0 flex-1 overflow-y-auto overflow-x-clip px-1">
			{@render children?.()}
		</div>
	</div>
</div>
