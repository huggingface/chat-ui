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
	import CarbonUserMultiple from "~icons/carbon/user-multiple";
	import CarbonSearch from "~icons/carbon/search";
	import CarbonTools from "~icons/carbon/tools";

	import Pagination from "$lib/components/Pagination.svelte";
	import { formatUserCount } from "$lib/utils/formatUserCount";
	import { getHref } from "$lib/utils/getHref";
	import { debounce } from "$lib/utils/debounce";
	import { useSettingsStore } from "$lib/stores/settings";
	import IconInternet from "$lib/components/icons/IconInternet.svelte";
	import { isDesktop } from "$lib/utils/isDesktop";
	import { SortKey } from "$lib/types/Assistant";

	export let data: PageData;

	$: assistantsCreator = $page.url.searchParams.get("user");
	$: createdByMe = data.user?.username && data.user.username === assistantsCreator;

	const SEARCH_DEBOUNCE_DELAY = 400;
	let filterInputEl: HTMLInputElement;
	let filterValue = data.query;
	let isFilterInPorgress = false;
	let sortValue = data.sort as SortKey;

	const onModelChange = (e: Event) => {
		const newUrl = getHref($page.url, {
			newKeys: { modelId: (e.target as HTMLSelectElement).value },
			existingKeys: { behaviour: "delete_except", keys: ["user"] },
		});
		resetFilter();
		goto(newUrl);
	};

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

	const sortAssistants = () => {
		const newUrl = getHref($page.url, {
			newKeys: { sort: sortValue },
			existingKeys: { behaviour: "delete", keys: ["p"] },
		});
		goto(newUrl);
	};

	const settings = useSettingsStore();
</script>

<svelte:head>
	{#if isHuggingChat}
		<title>HuggingChat - Assistants</title>
		<meta property="og:title" content="HuggingChat - Assistants" />
		<meta property="og:type" content="link" />
		<meta
			property="og:description"
			content="Browse HuggingChat assistants made by the community."
		/>
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
			<h1 class="text-2xl font-bold">Assistants</h1>
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
		<div class="mt-6 flex justify-between gap-2 max-sm:flex-col sm:items-center">
			<select
				class="mt-1 h-[34px] rounded-lg border border-gray-300 bg-gray-50 px-2 text-sm text-gray-900 focus:border-blue-700 focus:ring-blue-700 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400"
				bind:value={data.selectedModel}
				on:change={onModelChange}
			>
				<option value="">All models</option>
				{#each data.models.filter((model) => !model.unlisted) as model}
					<option value={model.name}>{model.name}</option>
				{/each}
			</select>

			<a
				href={`${base}/settings/assistants/new`}
				class="flex items-center gap-1 whitespace-nowrap rounded-lg border bg-white py-1 pl-1.5 pr-2.5 shadow-sm hover:bg-gray-50 hover:shadow-none dark:border-gray-600 dark:bg-gray-700 dark:hover:bg-gray-700"
			>
				<CarbonAdd />Create new assistant
			</a>
		</div>

		<div class="mt-7 flex flex-wrap items-center gap-x-2 gap-y-3 text-sm">
			{#if assistantsCreator && !createdByMe}
				<div
					class="flex items-center gap-1.5 rounded-full border border-gray-300 bg-gray-50 px-3 py-1 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
				>
					{assistantsCreator}'s Assistants
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
						href="https://hf.co/{assistantsCreator}"
						target="_blank"
						class="ml-auto flex items-center text-xs text-gray-500 underline hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-300"
						><CarbonArrowUpRight class="mr-1 flex-none text-[0.58rem]" target="_blank" />View {assistantsCreator}
						on HF</a
					>
				{/if}
			{:else}
				<a
					href={getHref($page.url, {
						existingKeys: { behaviour: "delete", keys: ["user", "modelId", "p", "q"] },
					})}
					on:click={resetFilter}
					class="flex items-center gap-1.5 rounded-full border px-3 py-1 {!assistantsCreator
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
							existingKeys: { behaviour: "delete", keys: ["modelId", "p", "q"] },
						})}
						on:click={resetFilter}
						class="flex items-center gap-1.5 truncate rounded-full border px-3 py-1 {assistantsCreator &&
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
				on:change={sortAssistants}
				class="rounded-lg border border-gray-300 bg-gray-50 px-2 py-1 text-sm text-gray-900 focus:border-blue-700 focus:ring-blue-700 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400"
			>
				<option value={SortKey.TRENDING}>{SortKey.TRENDING}</option>
				<option value={SortKey.POPULAR}>{SortKey.POPULAR}</option>
			</select>
		</div>

		<div class="mt-8 grid grid-cols-2 gap-3 sm:gap-5 md:grid-cols-3 lg:grid-cols-4">
			{#each data.assistants as assistant (assistant._id)}
				{@const hasRag =
					assistant?.rag?.allowAllDomains ||
					!!assistant?.rag?.allowedDomains?.length ||
					!!assistant?.rag?.allowedLinks?.length ||
					!!assistant?.dynamicPrompt}

				<button
					class="relative flex flex-col items-center justify-center overflow-hidden text-balance rounded-xl border bg-gray-50/50 px-4 py-6 text-center shadow hover:bg-gray-50 hover:shadow-inner dark:border-gray-800/70 dark:bg-gray-950/20 dark:hover:bg-gray-950/40 max-sm:px-4 sm:h-64 sm:pb-4 xl:pt-8"
					on:click={() => {
						if (data.settings.assistants.includes(assistant._id.toString())) {
							settings.instantSet({ activeModel: assistant._id.toString() });
							goto(`${base}` || "/");
						} else {
							goto(`${base}/assistant/${assistant._id}`);
						}
					}}
				>
					{#if assistant.userCount && assistant.userCount > 1}
						<div
							class="absolute right-3 top-3 flex items-center gap-1 text-xs text-gray-400"
							title="Number of users"
						>
							<CarbonUserMultiple class="text-xxs" />{formatUserCount(assistant.userCount)}
						</div>
					{/if}

					<div class="absolute left-3 top-3 flex items-center gap-1 text-xs text-gray-400">
						{#if assistant.tools?.length}
							<div
								class="grid size-5 place-items-center rounded-full bg-purple-500/10"
								title="This assistant uses the websearch."
							>
								<CarbonTools class="text-xs text-purple-600" />
							</div>
						{/if}
						{#if hasRag}
							<div
								class="grid size-5 place-items-center rounded-full bg-blue-500/10"
								title="This assistant uses the websearch."
							>
								<IconInternet classNames="text-sm text-blue-600" />
							</div>
						{/if}
					</div>

					{#if assistant.avatar}
						<img
							src="{base}/settings/assistants/{assistant._id}/avatar.jpg"
							alt="Avatar"
							class="mb-2 aspect-square size-12 flex-none rounded-full object-cover sm:mb-6 sm:size-20"
						/>
					{:else}
						<div
							class="mb-2 flex aspect-square size-12 flex-none items-center justify-center rounded-full bg-gray-300 text-2xl font-bold uppercase text-gray-500 dark:bg-gray-800 sm:mb-6 sm:size-20"
						>
							{assistant.name[0]}
						</div>
					{/if}
					<h3
						class="mb-2 line-clamp-2 max-w-full break-words text-center text-[.8rem] font-semibold leading-snug sm:text-sm"
					>
						{assistant.name}
					</h3>
					<p class="line-clamp-4 text-xs text-gray-700 dark:text-gray-400 sm:line-clamp-2">
						{assistant.description}
					</p>
					{#if assistant.createdByName}
						<p class="mt-auto pt-2 text-xs text-gray-400 dark:text-gray-500">
							Created by <a
								class="hover:underline"
								href="{base}/assistants?user={assistant.createdByName}"
							>
								{assistant.createdByName}
							</a>
						</p>
					{/if}
				</button>
			{:else}
				No assistants found
			{/each}
		</div>
		<Pagination
			classNames="w-full flex justify-center mt-14 mb-4"
			numItemsPerPage={data.numItemsPerPage}
			numTotalItems={data.numTotalItems}
		/>
	</div>
</div>
