<script lang="ts">
	import { onMount } from "svelte";
	import { base } from "$app/paths";
	import { afterNavigate, goto } from "$app/navigation";
	import { page } from "$app/state";
	import { useSettingsStore } from "$lib/stores/settings";
	import CarbonClose from "~icons/carbon/close";
	import CarbonTextLongParagraph from "~icons/carbon/text-long-paragraph";
	import CarbonChevronLeft from "~icons/carbon/chevron-left";
	import CarbonView from "~icons/carbon/view";

	import UserIcon from "~icons/carbon/user";
	import type { LayoutData } from "../$types";
	import { browser } from "$app/environment";
	import { isDesktop } from "$lib/utils/isDesktop";
	import { debounce } from "$lib/utils/debounce";

	interface Props {
		data: LayoutData;
		children?: import("svelte").Snippet;
	}

	let { data, children }: Props = $props();

	let previousPage: string = $state(base || "/");
	let showContent: boolean = $state(false);

	function checkDesktopRedirect() {
		if (
			browser &&
			isDesktop(window) &&
			page.url.pathname === `${base}/settings` &&
			!page.url.pathname.endsWith("/application")
		) {
			goto(`${base}/settings/application`);
		}
	}

	onMount(() => {
		// Show content when not on the root settings page
		showContent = page.url.pathname !== `${base}/settings`;
		// Initial desktop redirect check
		checkDesktopRedirect();

		// Add resize listener for desktop redirect
		if (browser) {
			const debouncedCheck = debounce(checkDesktopRedirect, 100);
			window.addEventListener("resize", debouncedCheck);
			return () => window.removeEventListener("resize", debouncedCheck);
		}
	});

	afterNavigate(({ from }) => {
		if (from?.url && !from.url.pathname.includes("settings")) {
			previousPage = from.url.toString() || previousPage || base || "/";
		}
		// Show content when not on the root settings page
		showContent = page.url.pathname !== `${base}/settings`;
		// Check desktop redirect after navigation
		checkDesktopRedirect();
	});

	const settings = useSettingsStore();

	// Local filter for model list (filter on model id)
	let modelFilter = $state("");
	let normalizedFilter = $derived(modelFilter.trim().toLowerCase());
</script>

<div
	class="mx-auto grid h-full w-full max-w-[1400px] grid-cols-1 grid-rows-[auto,1fr] content-start gap-x-6 overflow-hidden p-4 md:grid-cols-3 md:grid-rows-[auto,1fr] md:p-4"
>
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
				<CarbonChevronLeft class="text-xl text-gray-900 hover:text-black" />
			</button>
		{/if}
		<h2 class="absolute left-0 right-0 mx-auto w-fit text-center text-xl font-bold md:hidden">
			Settings
		</h2>
		<button
			class="btn rounded-lg"
			aria-label="Close settings"
			onclick={() => {
				goto(previousPage);
			}}
		>
			<CarbonClose class="text-xl text-gray-900 hover:text-black" />
		</button>
	</div>
	{#if !(showContent && browser && !isDesktop(window))}
		<div
			class="col-span-1 flex flex-col overflow-y-auto whitespace-nowrap max-md:-mx-4 max-md:h-full md:pr-6"
			class:max-md:hidden={showContent && browser}
		>
			<!-- Section Headers -->
			<h3
				class="px-3 pb-1 pt-2 text-center text-xs font-semibold tracking-wide text-gray-600 md:text-left"
			>
				Models
			</h3>

			<!-- Filter input -->
			<div class="px-2 py-2">
				<input
					bind:value={modelFilter}
					type="search"
					placeholder="Filter by name"
					aria-label="Filter models by id"
					class="w-full rounded-full border border-gray-300 bg-white px-4 py-1 text-sm
						placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-300"
				/>
			</div>

			{#each data.models
				.filter((el) => !el.unlisted)
				.filter((el) => el.id.toLowerCase().includes(normalizedFilter)) as model}
				<button
					type="button"
					onclick={() => goto(`${base}/settings/${model.id}`)}
					class="group flex h-9 w-full flex-none items-center gap-1 rounded-lg px-3 text-[13px] text-gray-600 hover:bg-gray-100
					md:rounded-xl md:px-3
					{model.id === page.params.model ? '!bg-gray-100 !text-gray-800' : ''}"
					aria-label="Configure {model.displayName}"
				>
					<div class="mr-auto truncate">{model.displayName}</div>

					{#if model.multimodal || $settings.multimodalOverrides?.[model.id]}
						<span
							title="Supports image inputs (multimodal)"
							class="grid size-[21px] place-items-center rounded-md border border-blue-700 dark:border-blue-500"
							aria-label="Model is multimodal"
							role="img"
						>
							<CarbonView class="text-xxs text-blue-700 dark:text-blue-500" />
						</span>
					{/if}

					{#if $settings.customPrompts?.[model.id]}
						<CarbonTextLongParagraph
							class="size-6 rounded-md border border-gray-300 p-1 text-gray-800"
						/>
					{/if}
					{#if model.id === $settings.activeModel}
						<div
							class="flex h-[21px] items-center rounded-md bg-black/90 px-2 text-[10px] font-semibold leading-none text-white"
						>
							Active
						</div>
					{/if}
				</button>
			{/each}

			<div class="my-2 mt-auto w-full border-b border-gray-200"></div>
			<button
				type="button"
				onclick={() => goto(`${base}/settings/application`)}
				class="group flex h-9 w-full flex-none items-center gap-1 rounded-lg px-3 text-[13px] text-gray-600 hover:bg-gray-100 max-md:order-first md:rounded-xl md:px-3
				{page.url.pathname === `${base}/settings/application` ? '!bg-gray-100 !text-gray-800' : ''}"
				aria-label="Configure application settings"
			>
				<UserIcon class="text-sm" />
				Application Settings
			</button>
		</div>
	{/if}
	{#if showContent}
		<div
			class="col-span-1 w-full overflow-y-auto overflow-x-clip px-1 md:col-span-2 md:row-span-2"
			class:max-md:hidden={!showContent && browser}
		>
			{@render children?.()}
		</div>
	{/if}
</div>
