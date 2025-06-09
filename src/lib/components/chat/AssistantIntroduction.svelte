<script lang="ts">
	import { createEventDispatcher } from "svelte";
	import { base } from "$app/paths";
	import { goto } from "$app/navigation";
	import type { Model } from "$lib/types/Model";
	import type { Assistant } from "$lib/types/Assistant";
	import { useSettingsStore } from "$lib/stores/settings";
	import { formatUserCount } from "$lib/utils/formatUserCount";
	import IconGear from "~icons/bi/gear-fill";
	import IconInternet from "../icons/IconInternet.svelte";
	import CarbonExport from "~icons/carbon/export";
	import CarbonCheckmark from "~icons/carbon/checkmark";
	import CarbonRenew from "~icons/carbon/renew";
	import CarbonUserMultiple from "~icons/carbon/user-multiple";
	import CarbonTools from "~icons/carbon/tools";

	import { share } from "$lib/utils/share";
	import { usePublicConfig } from "$lib/utils/PublicConfig.svelte";

	import { page } from "$app/state";

	const publicConfig = usePublicConfig();

	interface Props {
		models: Model[];
		assistant: Pick<
			Assistant,
			| "avatar"
			| "name"
			| "rag"
			| "dynamicPrompt"
			| "modelId"
			| "createdByName"
			| "exampleInputs"
			| "_id"
			| "description"
			| "userCount"
			| "tools"
		>;
	}

	let { models, assistant }: Props = $props();

	const dispatch = createEventDispatcher<{ message: string }>();

	let hasRag = $derived(
		assistant?.rag?.allowAllDomains ||
			(assistant?.rag?.allowedDomains?.length ?? 0) > 0 ||
			(assistant?.rag?.allowedLinks?.length ?? 0) > 0 ||
			assistant?.dynamicPrompt
	);

	const prefix =
		publicConfig.PUBLIC_SHARE_PREFIX || `${publicConfig.PUBLIC_ORIGIN || page.url.origin}${base}`;

	let shareUrl = $derived(`${prefix}/assistant/${assistant?._id}`);

	let isCopied = $state(false);

	const settings = useSettingsStore();
</script>

<div class="my-auto grid gap-8 lg:grid-cols-9">
	<div class="lg:col-span-4">
		<div>
			<div class="mb-3 flex items-center">
				{#if assistant.avatar}
					<img
						src={`${base}/settings/assistants/${assistant._id.toString()}/avatar.jpg?hash=${
							assistant.avatar
						}`}
						alt="avatar"
						class="mr-3 size-10 flex-none rounded-full object-cover"
					/>
				{:else}
					<div
						class="mr-3 flex size-10 flex-none items-center justify-center rounded-full bg-gray-300 object-cover text-xl font-bold uppercase text-gray-500 dark:bg-gray-600"
					>
						{assistant?.name[0]}
					</div>
				{/if}
				<div class="text-2xl font-semibold">
					{assistant.name}
				</div>
			</div>
			<p class="line-clamp-5 text-sm leading-relaxed text-gray-600 dark:text-gray-400">
				{assistant.description || "No description provided."}
			</p>

			<button
				onclick={() => {
					settings.instantSet({
						activeModel: models[0].name,
					});
					goto(`${base}/`);
				}}
				class="mt-4 inline-flex w-fit items-center rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700"
			>
				<CarbonRenew class="mr-1.5 text-xxs" /> Reset to default model
			</button>
		</div>
	</div>
	<div class="lg:col-span-5 lg:pl-12">
		<div class="overflow-hidden rounded-xl border dark:border-gray-800">
			<div class="flex flex-wrap items-center justify-between gap-2 p-3">
				<div class="flex flex-wrap items-center gap-2">
					<div class="hidden text-sm font-medium text-gray-600 dark:text-gray-400 sm:block">
						About this Assistant
					</div>
					{#if assistant.createdByName}
						<span class="hidden text-gray-400 sm:block">•</span>
						<a
							class="text-sm text-gray-500 hover:underline"
							href="{base}/assistants?user={assistant.createdByName}"
						>
							{#if !import.meta.env.SSR && window.innerWidth < 640}By
							{/if}{assistant.createdByName}
						</a>
					{/if}
				</div>
				<div class="flex gap-1 self-start">
					<button
						class="btn flex h-7 w-7 rounded-full bg-gray-100 p-1 text-xs hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-800 dark:hover:bg-gray-600"
						onclick={() => {
							if (!isCopied) {
								share(shareUrl, assistant.name);
								isCopied = true;
								setTimeout(() => {
									isCopied = false;
								}, 2000);
							}
						}}
						title="Share assistant"
					>
						{#if isCopied}
							<CarbonCheckmark class="text-green-600" />
						{:else}
							<CarbonExport />
						{/if}
					</button>
					<a
						href="{base}/settings/assistants/{assistant._id.toString()}"
						aria-label="Settings"
						title="Settings"
						class="btn flex h-7 w-7 rounded-full bg-gray-100 p-1 text-xs hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-800 dark:hover:bg-gray-600"
						><IconGear /></a
					>
				</div>
			</div>
			<div class="grid gap-3 bg-gray-50 p-3 text-sm dark:bg-gray-800/70">
				<div class="flex flex-wrap gap-2">
					{#if hasRag}
						<div
							class="flex h-6 items-center gap-1 rounded-full bg-blue-500/10 pl-1.5 pr-2.5 text-xs"
							title="This assistant uses web search"
						>
							<IconInternet classNames="text-sm text-blue-600" />
							Internet access
						</div>
					{/if}

					{#if assistant?.tools?.length}
						<div
							class="flex h-6 items-center gap-1 rounded-full bg-purple-500/10 pl-1.5 pr-2.5 text-xs"
							title="This assistant can use tools"
						>
							<CarbonTools class="text-sm text-purple-600" />
							Has tools
						</div>
					{/if}

					{#if assistant.userCount && assistant.userCount > 1}
						<div
							class="flex h-6 items-center gap-1 rounded-full bg-gray-500/10 pl-1.5 pr-2.5 text-xs"
							title="Number of users"
						>
							<CarbonUserMultiple class="text-sm text-gray-600 dark:text-gray-400" />
							{formatUserCount(assistant.userCount)} users
						</div>
					{/if}
				</div>
			</div>
		</div>
	</div>
	{#if assistant.exampleInputs && assistant.exampleInputs.length > 0}
		<div class="lg:col-span-9 lg:mt-6">
			<p class="mb-3 text-center text-gray-600 dark:text-gray-300 lg:text-left">Examples</p>
			<div
				class="flex max-h-60 gap-2 overflow-x-auto pb-2 text-center scrollbar-thin scrollbar-thumb-gray-300 dark:scrollbar-thumb-gray-700 lg:grid lg:grid-cols-3 lg:overflow-y-auto lg:text-left"
			>
				{#each assistant.exampleInputs as example}
					<button
						type="button"
						class="flex-shrink-0 rounded-xl border bg-gray-50 px-2.5 py-2 text-sm text-gray-600 hover:bg-gray-100 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700 sm:px-3 lg:w-full xl:px-3.5 xl:text-base"
						onclick={() => dispatch("message", example)}
					>
						{example}
					</button>
				{/each}
			</div>
		</div>
	{/if}
	<div class="h-40 sm:h-24"></div>
</div>
