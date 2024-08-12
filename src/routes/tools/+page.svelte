<script lang="ts">
	import type { PageData } from "./$types";

	import { env as envPublic } from "$env/dynamic/public";
	import { isHuggingChat } from "$lib/utils/isHuggingChat";

	import { goto } from "$app/navigation";
	import { base } from "$app/paths";
	import { page } from "$app/stores";

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

	export let data: PageData;

	$: tools = data.tools.filter((t) =>
		activeOnly ? data.settings.tools.some((toolId) => toolId === t._id.toString()) : true
	);

	$: toolsCreator = $page.url.searchParams.get("user");
	$: createdByMe = data.user?.username && data.user.username === toolsCreator;
	$: activeOnly = $page.url.searchParams.get("active") === "true";

	const SEARCH_DEBOUNCE_DELAY = 400;
	let filterInputEl: HTMLInputElement;
	let filterValue = data.query;
	let isFilterInPorgress = false;
	let sortValue = data.sort as SortKey;

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
		const newUrl = getHref($page.url, {
			newKeys: { q: value },
			existingKeys: { behaviour: "delete", keys: ["p"] },
		});
		await goto(newUrl);
		if (isDesktop(window)) {
			setTimeout(() => filterInputEl.focus(), 0);
		}
		isFilterInPorgress = false;

		// there was a new filter query before server returned response
		if (filterValue !== value) {
			filterOnName(filterValue);
		}
	}, SEARCH_DEBOUNCE_DELAY);

	const sortTools = () => {
		const newUrl = getHref($page.url, {
			newKeys: { sort: sortValue },
			existingKeys: { behaviour: "delete", keys: ["p"] },
		});
		goto(newUrl);
	};

	const goToActiveUrl = () => {
		return getHref($page.url, {
			newKeys: { active: "true" },
			existingKeys: { behaviour: "delete_except", keys: ["active", "sort"] },
		});
	};

	const goToCommunity = () => {
		return getHref($page.url, {
			existingKeys: { behaviour: "delete_except", keys: ["sort", "q"] },
		});
	};
</script>

<svelte:head>
	{#if isHuggingChat}
		<title>HuggingChat - Tools</title>
		<meta property="og:title" content="HuggingChat - Tools" />
		<meta property="og:type" content="link" />
		<meta property="og:description" content="Browse HuggingChat tools made by the community." />
		<meta
			property="og:image"
			content="{envPublic.PUBLIC_ORIGIN ||
				$page.url.origin}{base}/{envPublic.PUBLIC_APP_ASSETS}/assistants-thumbnail.png"
		/>
		<meta property="og:url" content={$page.url.href} />
	{/if}
</svelte:head>

<div class="scrollbar-custom mr-1 h-full overflow-y-auto py-12 max-sm:pt-8 md:py-24">
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
				>
					<CarbonHelpFilled />
				</a>
			{/if}
		</div>
		<h3 class="text-gray-500">Popular assistants made by the community</h3>
		<div class="ml-auto mt-6 flex justify-between gap-2 max-sm:flex-col sm:items-center">
			<a
				href={`${base}/tools/new`}
				class="flex items-center gap-1 whitespace-nowrap rounded-lg border bg-white py-1 pl-1.5 pr-2.5 shadow-sm hover:bg-gray-50 hover:shadow-none dark:border-gray-600 dark:bg-gray-700 dark:hover:bg-gray-700"
			>
				<CarbonAdd />Create new tool
			</a>
		</div>

		<div class="mt-7 flex flex-wrap items-center gap-x-2 gap-y-3 text-sm">
			{#if toolsCreator && !createdByMe}
				<div
					class="flex items-center gap-1.5 rounded-full border border-gray-300 bg-gray-50 px-3 py-1 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
				>
					{toolsCreator}'s Assistants
					<a
						href={getHref($page.url, {
							existingKeys: { behaviour: "delete", keys: ["user", "modelId", "p", "q"] },
						})}
						on:click={resetFilter}
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
					Active ({$page.data.settings?.tools?.length})
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
						href={getHref($page.url, {
							newKeys: { user: data.user.username },
							existingKeys: { behaviour: "delete", keys: ["modelId", "p", "q", "active"] },
						})}
						on:click={resetFilter}
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
					on:input={(e) => filterOnName(e.currentTarget.value)}
					bind:this={filterInputEl}
					maxlength="150"
					type="search"
				/>
			</div>
			<select
				bind:value={sortValue}
				on:change={sortTools}
				class="rounded-lg border border-gray-300 bg-gray-50 px-2 py-1 text-sm text-gray-900 focus:border-blue-700 focus:ring-blue-700 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400"
			>
				<option value={SortKey.TRENDING}>{SortKey.TRENDING}</option>
				<option value={SortKey.POPULAR}>{SortKey.POPULAR}</option>
			</select>
		</div>

		<div class="mt-8 grid grid-cols-1 gap-3 sm:gap-5 lg:grid-cols-2">
			{#each tools as tool}
				<a
					href="{base}/tools/{tool._id.toString()}"
					class="relative flex flex-row items-center gap-4 overflow-hidden text-balance rounded-xl border bg-gray-50/50 px-4 text-center shadow hover:bg-gray-50 hover:shadow-inner dark:border-gray-800/70 dark:bg-gray-950/20 dark:hover:bg-gray-950/40 max-sm:px-4 sm:h-24"
				>
					<ToolLogo color={tool.color} icon={tool.icon} />
					<div class="flex w-full flex-col items-start text-left">
						<span class="font-bold">
							<span class="w-full overflow-clip">
								{tool.displayName}
							</span>
							{#if ($page.data.settings?.tools ?? []).includes(tool._id.toString())}
								<!-- active badge -->
								<span
									class="inline-flex items-center rounded-full bg-blue-800 px-2 py-0.5 text-xs font-semibold text-white"
									>Active</span
								>
							{/if}
						</span>
						<span class="font-mono text-xs text-gray-400">
							{tool.baseUrl ?? "Internal tool"}
						</span>
						{#if tool.createdByName}
							<p class=" pt-2 text-xs text-gray-400 dark:text-gray-500">
								Added by <a
									class="hover:underline"
									href="{base}/tools?user={tool.createdByName}"
									on:click|stopPropagation
								>
									{tool.createdByName}
								</a>
								<span class="text-gray-300">•</span>
								{tool.useCount} runs
							</p>
						{:else}
							<p class="pt-2 text-xs text-gray-400 dark:text-gray-500">HuggingChat official tool</p>
						{/if}
					</div>
				</a>
			{:else}
				No tools found
			{/each}
		</div>

		<Pagination
			classNames="w-full flex justify-center mt-14 mb-4"
			numItemsPerPage={data.numItemsPerPage}
			numTotalItems={data.numTotalItems}
		/>
	</div>
</div>
