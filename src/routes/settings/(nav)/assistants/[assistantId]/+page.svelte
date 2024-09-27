<script lang="ts">
	import { enhance } from "$app/forms";
	import { base } from "$app/paths";
	import { page } from "$app/stores";
	import { goto } from "$app/navigation";
	import { env as envPublic } from "$env/dynamic/public";
	import { useSettingsStore } from "$lib/stores/settings";
	import type { PageData } from "./$types";

	import CarbonPen from "~icons/carbon/pen";
	import CarbonTrash from "~icons/carbon/trash-can";
	import CarbonCopy from "~icons/carbon/copy-file";
	import CarbonFlag from "~icons/carbon/flag";
	import CarbonLink from "~icons/carbon/link";
	import CarbonChat from "~icons/carbon/chat";
	import CarbonStar from "~icons/carbon/star";
	import CarbonTools from "~icons/carbon/tools";

	import CopyToClipBoardBtn from "$lib/components/CopyToClipBoardBtn.svelte";
	import ReportModal from "./ReportModal.svelte";
	import IconInternet from "$lib/components/icons/IconInternet.svelte";
	import ToolBadge from "$lib/components/ToolBadge.svelte";

	export let data: PageData;

	$: assistant = data.assistants.find((el) => el._id.toString() === $page.params.assistantId);

	const settings = useSettingsStore();

	const prefix =
		envPublic.PUBLIC_SHARE_PREFIX || `${envPublic.PUBLIC_ORIGIN || $page.url.origin}${base}`;

	$: shareUrl = `${prefix}/assistant/${assistant?._id}`;

	let displayReportModal = false;

	$: hasRag =
		assistant?.rag?.allowAllDomains ||
		!!assistant?.rag?.allowedDomains?.length ||
		!!assistant?.rag?.allowedLinks?.length ||
		!!assistant?.dynamicPrompt;

	$: prepromptTags = assistant?.preprompt?.split(/(\{\{[^{}]*\}\})/) ?? [];
</script>

{#if displayReportModal}
	<ReportModal on:close={() => (displayReportModal = false)} />
{/if}
<div class="flex h-full flex-col gap-2">
	<div class="flex flex-col sm:flex-row sm:gap-6">
		<div class="mb-4 flex justify-center sm:mb-0">
			{#if assistant?.avatar}
				<img
					src={`${base}/settings/assistants/${assistant?._id}/avatar.jpg?hash=${assistant?.avatar}`}
					alt="Avatar"
					class="size-16 flex-none rounded-full object-cover sm:size-24"
				/>
			{:else}
				<div
					class="flex size-16 flex-none items-center justify-center rounded-full bg-gray-300 text-4xl font-semibold uppercase text-gray-500 sm:size-24"
				>
					{assistant?.name[0]}
				</div>
			{/if}
		</div>

		<div class="flex-1">
			<div class="flex flex-wrap items-center gap-2">
				<h1 class="break-words text-xl font-semibold">
					{assistant?.name}
				</h1>

				{#if hasRag}
					<span
						class="inline-grid size-5 place-items-center rounded-full bg-blue-500/10"
						title="This assistant uses the websearch."
					>
						<IconInternet classNames="text-sm text-blue-600" />
					</span>
				{/if}
				<span class="rounded-full border px-2 py-0.5 text-sm leading-none text-gray-500"
					>public</span
				>
			</div>

			{#if assistant?.description}
				<p class="mb-2 line-clamp-2 text-sm text-gray-500">
					{assistant.description}
				</p>
			{/if}

			<p class="text-sm text-gray-500">
				Model: <span class="font-semibold"> {assistant?.modelId} </span>
				<span class="text-gray-300">•</span> Created by
				<a class="underline" href="{base}/assistants?user={assistant?.createdByName}">
					{assistant?.createdByName}
				</a>
			</p>
			<div
				class="flex flex-wrap items-center gap-x-4 gap-y-2 whitespace-nowrap text-sm text-gray-500 hover:*:text-gray-800 max-sm:justify-center"
			>
				<div class="w-full sm:w-auto">
					<button
						class="mx-auto my-2 flex w-full w-min items-center justify-center rounded-full bg-black px-3 py-1 text-base !text-white"
						name="Activate model"
						on:click|stopPropagation={() => {
							settings.instantSet({
								activeModel: $page.params.assistantId,
							});
							goto(`${base}/`);
						}}
					>
						<CarbonChat class="mr-1.5 text-sm" />
						New chat
					</button>
				</div>
				{#if assistant?.createdByMe}
					<a href="{base}/settings/assistants/{assistant?._id}/edit" class="underline"
						><CarbonPen class="mr-1.5 inline text-xs" />Edit
					</a>
					<form method="POST" action="?/delete" use:enhance>
						<button type="submit" class="flex items-center underline">
							<CarbonTrash class="mr-1.5 inline text-xs" />Delete</button
						>
					</form>
				{:else}
					<form method="POST" action="?/unsubscribe" use:enhance>
						<button type="submit" class="underline">
							<CarbonTrash class="mr-1.5 inline text-xs" />Remove</button
						>
					</form>
					<form method="POST" action="?/edit" use:enhance class="hidden">
						<button type="submit" class="underline">
							<CarbonCopy class="mr-1.5 inline text-xs" />Duplicate</button
						>
					</form>
					{#if !assistant?.reported}
						<button
							type="button"
							on:click={() => {
								displayReportModal = true;
							}}
							class="underline"
						>
							<CarbonFlag class="mr-1.5 inline text-xs" />Report
						</button>
					{:else}
						<button type="button" disabled class="text-gray-700">
							<CarbonFlag class="mr-1.5 inline text-xs" />Reported</button
						>
					{/if}
				{/if}
				{#if data?.user?.isAdmin}
					<form method="POST" action="?/delete" use:enhance>
						<button type="submit" class="flex items-center text-red-600 underline">
							<CarbonTrash class="mr-1.5 inline text-xs" />Delete</button
						>
					</form>
					{#if assistant?.featured}
						<form method="POST" action="?/unfeature" use:enhance>
							<button type="submit" class="flex items-center text-red-600 underline">
								<CarbonTrash class="mr-1.5 inline text-xs" />Un-feature</button
							>
						</form>
					{:else}
						<form method="POST" action="?/feature" use:enhance>
							<button type="submit" class="flex items-center text-green-600 underline">
								<CarbonStar class="mr-1.5 inline text-xs" />Feature</button
							>
						</form>
					{/if}
				{/if}
			</div>
		</div>
	</div>

	<div>
		<h2 class="text-lg font-semibold">Direct URL</h2>

		<p class="pb-2 text-sm text-gray-500">Share this link for people to use your assistant.</p>

		<div
			class="flex flex-row gap-2 rounded-lg border-2 border-gray-200 bg-gray-100 py-2 pl-3 pr-1.5"
		>
			<input disabled class="flex-1 truncate bg-inherit" value={shareUrl} />
			<CopyToClipBoardBtn
				value={shareUrl}
				classNames="!border-none !shadow-none !py-0 !px-1 !rounded-md"
			>
				<div class="flex items-center gap-1.5 text-gray-500 hover:underline">
					<CarbonLink />Copy
				</div>
			</CopyToClipBoardBtn>
		</div>
	</div>

	<!-- two columns for big screen, single column for small screen -->
	<div class="mb-12 mt-3">
		<h2 class="mb-2 inline font-semibold">System Instructions</h2>
		<div
			id="System Instructions"
			class="overlow-y-auto mt-2 box-border h-fit max-h-[240px] w-full overflow-y-auto whitespace-pre-line rounded-lg border-2 border-gray-200 bg-gray-100 p-2 disabled:cursor-not-allowed 2xl:max-h-[310px]"
		>
			{#if assistant?.dynamicPrompt}
				{#each prepromptTags as tag}
					{#if tag.startsWith("{{") && tag.endsWith("}}") && tag.includes("url=")}
						{@const url = tag.split("url=")[1].split("}}")[0]}
						<a
							target="_blank"
							href={url.startsWith("http") ? url : `//${url}`}
							class="break-words rounded-lg bg-blue-100 px-1 py-0.5 text-blue-800 hover:underline"
						>
							{tag}</a
						>
					{:else}
						{tag}
					{/if}
				{/each}
			{:else}
				{assistant?.preprompt}
			{/if}
		</div>

		{#if assistant?.tools?.length}
			<div class="mt-4">
				<div class="mb-1 flex items-center gap-1">
					<span
						class="inline-grid size-5 place-items-center rounded-full bg-purple-500/10"
						title="This assistant uses the websearch."
					>
						<CarbonTools class="text-xs text-purple-600" />
					</span>
					<h2 class="font-semibold">Tools</h2>
				</div>
				<p class="w-full text-sm text-gray-500">
					This Assistant has access to the following tools:
				</p>
				<ul class="mr-2 mt-2 flex flex-wrap gap-2.5 text-sm text-gray-800">
					{#each assistant.tools as tool}
						<ToolBadge toolId={tool} />
					{/each}
				</ul>
			</div>
		{/if}
		{#if hasRag}
			<div class="mt-4">
				<div class="mb-1 flex items-center gap-1">
					<span
						class="inline-grid size-5 place-items-center rounded-full bg-blue-500/10"
						title="This assistant uses the websearch."
					>
						<IconInternet classNames="text-sm text-blue-600" />
					</span>
					<h2 class=" font-semibold">Internet Access</h2>
				</div>
				{#if assistant?.rag?.allowAllDomains}
					<p class="text-sm text-gray-500">
						This Assistant uses Web Search to find information on Internet.
					</p>
				{:else if !!assistant?.rag?.allowedDomains && assistant?.rag?.allowedDomains.length}
					<p class="pb-4 text-sm text-gray-500">
						This Assistant can use Web Search on the following domains:
					</p>
					<ul class="mr-2 flex flex-wrap gap-2.5 text-sm text-gray-800">
						{#each assistant?.rag?.allowedDomains as domain}
							<li
								class="break-all rounded-lg border border-gray-200 bg-gray-100 px-2 py-0.5 leading-tight decoration-gray-400"
							>
								<a target="_blank" class="underline" href={domain}>{domain}</a>
							</li>
						{/each}
					</ul>
				{:else if !!assistant?.rag?.allowedLinks && assistant?.rag?.allowedLinks.length}
					<p class="pb-4 text-sm text-gray-500">This Assistant can browse the following links:</p>
					<ul class="mr-2 flex flex-wrap gap-2.5 text-sm text-gray-800">
						{#each assistant?.rag?.allowedLinks as link}
							<li
								class="break-all rounded-lg border border-gray-200 bg-gray-100 px-2 py-0.5 leading-tight decoration-gray-400"
							>
								<a target="_blank" class="underline" href={link}>{link}</a>
							</li>
						{/each}
					</ul>
				{/if}
				{#if assistant?.dynamicPrompt}
					<p class="text-sm text-gray-500">
						This Assistant has dynamic prompts enabled and can make requests to external services.
					</p>
				{/if}
			</div>
		{/if}
	</div>
</div>
