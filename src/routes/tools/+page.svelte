<script lang="ts">
	import { createBubbler } from "svelte/legacy";

	const bubble = createBubbler();
	import type { PageData } from "./$types";

	import { isHuggingChat } from "$lib/utils/isHuggingChat";

	import { goto } from "$app/navigation";
	import { base } from "$app/paths";
	import { page } from "$app/state";

	import CarbonAdd from "~icons/carbon/add";
	import CarbonHelpFilled from "~icons/carbon/help-filled";
	import CarbonClose from "~icons/carbon/close";
	import CarbonArrowUpRight from "~icons/carbon/arrow-up-right";
	import CarbonEarthAmerica from "~icons/carbon/earth-americas-filled";
	import CarbonSearch from "~icons/carbon/search";
	import Pagination from "$lib/components/Pagination.svelte";
	import { getHref } from "$lib/utils/getHref";
	import { debounce } from "$lib/utils/debounce";
	import { isDesktop } from "$lib/utils/isDesktop";
	import { SortKey } from "$lib/types/Assistant";
	import ToolLogo from "$lib/components/ToolLogo.svelte";
	import { ReviewStatus } from "$lib/types/Review";
	import { useSettingsStore } from "$lib/stores/settings";
	import { loginModalOpen } from "$lib/stores/loginModal";

	interface Props {
		data: PageData;
	}

	let { data }: Props = $props();

	const settings = useSettingsStore();

	const SEARCH_DEBOUNCE_DELAY = 400;
	let filterInputEl: HTMLInputElement | undefined = $state();
	let filterValue = $state(data.query);
	let isFilterInPorgress = false;
	let sortValue = $state(data.sort as SortKey);

	let showUnfeatured = $state(data.showUnfeatured);

	const resetFilter = () => {
		filterValue = "";
		isFilterInPorgress = false;
	};

	const filterOnName = debounce(async (value: string) => {
		filterValue = value;

		if (isFilterInPorgress) {
			return;
		}

		isFilterInPorgress = true;
		const newUrl = getHref(page.url, {
			newKeys: { q: value },
			existingKeys: { behaviour: "delete", keys: ["p"] },
		});
		await goto(newUrl);
		if (isDesktop(window)) {
			setTimeout(() => filterInputEl?.focus(), 0);
		}
		isFilterInPorgress = false;

		// there was a new filter query before server returned response
		if (filterValue !== value) {
			filterOnName(filterValue);
		}
	}, SEARCH_DEBOUNCE_DELAY);

	const sortTools = () => {
		const newUrl = getHref(page.url, {
			newKeys: { sort: sortValue },
			existingKeys: { behaviour: "delete", keys: ["p"] },
		});
		goto(newUrl);
	};

	const toggleShowUnfeatured = () => {
		showUnfeatured = !showUnfeatured;
		const newUrl = getHref(page.url, {
			newKeys: { showUnfeatured: showUnfeatured ? "true" : undefined },
			existingKeys: { behaviour: "delete", keys: [] },
		});
		goto(newUrl);
	};

	const goToActiveUrl = () => {
		return getHref(page.url, {
			newKeys: { active: "true" },
			existingKeys: { behaviour: "delete_except", keys: ["active", "sort"] },
		});
	};

	const goToCommunity = () => {
		return getHref(page.url, {
			existingKeys: { behaviour: "delete_except", keys: ["sort", "q"] },
		});
	};
	let activeOnly = $derived(page.url.searchParams.get("active") === "true");
	let tools = $derived(
		data.tools.filter((t) =>
			activeOnly ? data.settings.tools.some((toolId) => toolId === t._id.toString()) : true
		)
	);
	let toolsCreator = $derived(page.url.searchParams.get("user"));
	let createdByMe = $derived(data.user?.username && data.user.username === toolsCreator);
	let currentModelSupportTools = $derived(
		data.models.find((m) => m.id === $settings.activeModel)?.tools ?? false
	);
</script>

<div class="scrollbar-custom h-full overflow-y-auto py-12 max-sm:pt-8 md:py-24">
	<div class="pt-42 mx-auto flex flex-col px-5 xl:w-[60rem] 2xl:w-[64rem]">
		<div class="flex items-center">
			<h1 class="text-2xl font-bold">Tools</h1>
			{#if isHuggingChat}
				<div class="5 ml-1.5 rounded-lg text-xxs uppercase text-gray-500 dark:text-gray-500">
					beta
				</div>
				<a
					href="https://huggingface.co/spaces/huggingchat/chat-ui/discussions/357"
					class="ml-auto dark:text-gray-400 dark:hover:text-gray-300"
					target="_blank"
					aria-label="Hub discussion about tools"
				>
					<CarbonHelpFilled />
				</a>
			{/if}
		</div>
		<h2 class="text-gray-500">Popular tools made by the community</h2>
		<h3 class="mt-2 w-fit text-purple-700 dark:text-purple-300">
			This feature is <span
				class="rounded-lg bg-purple-100 px-2 py-1 font-semibold dark:bg-purple-800/50"
				>experimental</span
			>. Consider
			<a
				class="underline hover:text-purple-500"
				href="https://huggingface.co/spaces/huggingchat/chat-ui/discussions/569"
				target="_blank">sharing your feedback with us!</a
			>
		</h3>
		<div class="ml-auto mt-6 flex justify-between gap-2 max-sm:flex-col sm:items-center">
			{#if data.user?.isAdmin}
				<label class="mr-auto flex items-center gap-1 text-red-500" title="Admin only feature">
					<input type="checkbox" checked={showUnfeatured} onchange={toggleShowUnfeatured} />
					Show unfeatured tools
				</label>
			{/if}
			{#if page.data.loginRequired && !data.user}
				<button
					onclick={() => {
						$loginModalOpen = true;
					}}
					class="flex items-center gap-1 whitespace-nowrap rounded-lg border bg-white py-1 pl-1.5 pr-2.5 shadow-sm hover:bg-gray-50 hover:shadow-none dark:border-gray-600 dark:bg-gray-700 dark:hover:bg-gray-700"
				>
					<CarbonAdd />Create new tool
				</button>
			{:else}
				<a
					href={`${base}/tools/new`}
					class="flex items-center gap-1 whitespace-nowrap rounded-lg border bg-white py-1 pl-1.5 pr-2.5 shadow-sm hover:bg-gray-50 hover:shadow-none dark:border-gray-600 dark:bg-gray-700 dark:hover:bg-gray-700"
				>
					<CarbonAdd />Create new tool
				</a>
			{/if}
		</div>

		<div class="mb-4 mt-7 flex flex-wrap items-center gap-x-2 gap-y-3 text-sm">
			{#if toolsCreator && !createdByMe}
				<div
					class="flex items-center gap-1.5 rounded-full border border-gray-300 bg-gray-50 px-3 py-1 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
				>
					{toolsCreator}'s tools
					<a
						href={getHref(page.url, {
							existingKeys: { behaviour: "delete", keys: ["user", "modelId", "p", "q"] },
						})}
						onclick={resetFilter}
						class="group"
						><CarbonClose
							class="text-xs group-hover:text-gray-800 dark:group-hover:text-gray-300"
						/></a
					>
				</div>
				{#if isHuggingChat}
					<a
						href="https://hf.co/{toolsCreator}"
						target="_blank"
						class="ml-auto flex items-center text-xs text-gray-500 underline hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-300"
						><CarbonArrowUpRight class="mr-1 flex-none text-[0.58rem]" target="_blank" />View {toolsCreator}
						on HF</a
					>
				{/if}
			{:else}
				<a
					href={goToActiveUrl()}
					class="flex items-center gap-1.5 rounded-full border px-3 py-1 {activeOnly
						? 'border-gray-300 bg-gray-50  dark:border-gray-600 dark:bg-gray-700 dark:text-white'
						: 'border-transparent text-gray-400 hover:text-gray-800 dark:hover:text-gray-300'}"
				>
					<CarbonEarthAmerica class="text-xs" />
					Active ({page.data.settings?.tools?.length})
				</a>
				<a
					href={goToCommunity()}
					class="flex items-center gap-1.5 rounded-full border px-3 py-1 {!activeOnly &&
					!toolsCreator
						? 'border-gray-300 bg-gray-50  dark:border-gray-600 dark:bg-gray-700 dark:text-white'
						: 'border-transparent text-gray-400 hover:text-gray-800 dark:hover:text-gray-300'}"
				>
					<CarbonEarthAmerica class="text-xs" />
					Community
				</a>
				{#if data.user?.username}
					<a
						href={getHref(page.url, {
							newKeys: { user: data.user.username },
							existingKeys: { behaviour: "delete", keys: ["modelId", "p", "q", "active"] },
						})}
						onclick={resetFilter}
						class="flex items-center gap-1.5 truncate rounded-full border px-3 py-1 {toolsCreator &&
						createdByMe
							? 'border-gray-300 bg-gray-50  dark:border-gray-600 dark:bg-gray-700 dark:text-white'
							: 'border-transparent text-gray-400 hover:text-gray-800 dark:hover:text-gray-300'}"
						>{data.user.username}
					</a>
				{/if}
			{/if}
			<div
				class="relative ml-auto flex h-[30px] w-40 items-center rounded-full border px-2 has-[:focus]:border-gray-400 dark:border-gray-600 sm:w-64"
			>
				<CarbonSearch class="pointer-events-none absolute left-2 text-xs text-gray-400" />
				<input
					class="h-[30px] w-full bg-transparent pl-5 focus:outline-none"
					placeholder="Filter by name"
					value={filterValue}
					oninput={(e) => filterOnName(e.currentTarget.value)}
					bind:this={filterInputEl}
					maxlength="150"
					type="search"
					aria-label="Filter tools by name"
				/>
			</div>
			<select
				bind:value={sortValue}
				onchange={sortTools}
				class="rounded-lg border border-gray-300 bg-gray-50 px-2 py-1 text-sm text-gray-900 focus:border-blue-700 focus:ring-blue-700 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400"
				aria-label="Sort tools"
			>
				<option value={SortKey.TRENDING}>{SortKey.TRENDING}</option>
				<option value={SortKey.POPULAR}>{SortKey.POPULAR}</option>
			</select>
		</div>

		{#if !currentModelSupportTools}
			<div class="mx-auto text-center text-sm text-purple-700 dark:text-purple-300">
				You are currently not using a model that supports tools. Activate one
				<a href="{base}/models" class="underline">here</a>.
			</div>
		{/if}

		<div class="mt-4 grid grid-cols-1 gap-3 sm:gap-5 lg:grid-cols-2">
			{#each tools as tool}
				{@const isActive = (page.data.settings?.tools ?? []).includes(tool._id.toString())}
				{@const isOfficial = tool.type === "config"}
				<div
					onclick={() => goto(`${base}/tools/${tool._id.toString()}`)}
					onkeydown={(e) => e.key === "Enter" && goto(`${base}/tools/${tool._id.toString()}`)}
					role="button"
					tabindex="0"
					class="relative flex flex-row items-center gap-4 overflow-hidden text-balance rounded-xl border bg-gray-50/50 px-4 text-center shadow hover:bg-gray-50 hover:shadow-inner dark:bg-gray-950/20 dark:hover:bg-gray-950/40 max-sm:px-4 sm:h-24 {!isOfficial &&
					tool.review !== ReviewStatus.APPROVED
						? ' border-red-500/30'
						: 'dark:border-gray-800/70'}"
					class:!border-blue-600={isActive}
				>
					{#key tool.color + tool.icon}
						<ToolLogo color={tool.color} icon={tool.icon} />
					{/key}
					<div class="flex h-full w-full flex-col items-start py-2 text-left">
						<span class="font-bold">
							<span class="w-full overflow-clip">
								{tool.displayName}
							</span>
							{#if isActive}
								<span
									class="mx-1.5 inline-flex items-center rounded-full bg-blue-600 px-2 py-0.5 text-xs font-semibold text-white"
									>Active</span
								>
							{/if}
						</span>
						<span class="line-clamp-1 font-mono text-xs text-gray-400">
							{tool.baseUrl ?? "Internal tool"}
						</span>

						<p class=" line-clamp-1 w-full text-sm text-gray-600 dark:text-gray-300">
							{tool.description}
						</p>

						{#if !isOfficial && tool.type === "community"}
							<p class="mt-auto text-xs text-gray-400 dark:text-gray-500">
								Added by <a
									class="hover:underline"
									href="{base}/tools?user={tool.createdByName}"
									onclick={(e) => {
										e.stopPropagation();
										bubble("click");
									}}
								>
									{tool.createdByName}
								</a>
								<span class="text-gray-300">•</span>
								{#if tool.useCount === 1}
									1 run
								{:else}
									{tool.useCount} runs
								{/if}
							</p>
						{:else}
							<p class="mt-auto text-xs text-purple-700 dark:text-purple-400">
								HuggingChat official tool
							</p>
						{/if}
					</div>
				</div>
			{:else}
				{#if activeOnly}
					You don't have any active tools.
				{:else}
					No tools found
				{/if}
			{/each}
		</div>

		<Pagination
			classNames="w-full flex justify-center mt-14 mb-4"
			numItemsPerPage={data.numItemsPerPage}
			numTotalItems={data.numTotalItems}
		/>
	</div>
</div>
