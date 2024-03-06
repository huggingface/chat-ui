<script lang="ts">
	import { enhance } from "$app/forms";
	import { base } from "$app/paths";
	import { page } from "$app/stores";
	import { PUBLIC_ORIGIN, PUBLIC_SHARE_PREFIX } from "$env/static/public";
	import { useSettingsStore } from "$lib/stores/settings";
	import type { PageData } from "./$types";

	import CarbonPen from "~icons/carbon/pen";
	import CarbonTrash from "~icons/carbon/trash-can";
	import CarbonCopy from "~icons/carbon/copy-file";
	import CarbonFlag from "~icons/carbon/flag";
	import CarbonLink from "~icons/carbon/link";
	import CopyToClipBoardBtn from "$lib/components/CopyToClipBoardBtn.svelte";
	import ReportModal from "./ReportModal.svelte";

	export let data: PageData;

	$: assistant = data.assistants.find((el) => el._id.toString() === $page.params.assistantId);

	const settings = useSettingsStore();

	$: isActive = $settings.activeModel === $page.params.assistantId;

	const prefix = PUBLIC_SHARE_PREFIX || `${PUBLIC_ORIGIN || $page.url.origin}${base}`;

	$: shareUrl = `${prefix}/assistant/${assistant?._id}`;

	let displayReportModal = false;
</script>

{#if displayReportModal}
	<ReportModal on:close={() => (displayReportModal = false)} />
{/if}
<div class="flex h-full flex-col gap-2">
	<div class="flex gap-6">
		{#if assistant?.avatar}
			<!-- crop image if not square  -->
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

		<div class="flex-1">
			<div class="mb-1.5">
				<h1 class="mr-2 inline text-xl font-semibold">
					{assistant?.name}
				</h1>
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
				class="flex items-center gap-4 whitespace-nowrap text-sm text-gray-500 hover:*:text-gray-800"
			>
				<button
					class="{isActive
						? 'bg-gray-100 text-gray-800'
						: 'bg-black !text-white'} my-2 flex w-fit items-center rounded-full px-3 py-1 text-base"
					disabled={isActive}
					name="Activate model"
					on:click|stopPropagation={() => {
						$settings.activeModel = $page.params.assistantId;
					}}
				>
					{isActive ? "Active" : "Activate"}
				</button>
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

	<h2 class="mt-4 text-lg font-semibold">System Instructions</h2>

	<textarea
		disabled
		class="min-h-[8lh] w-full flex-1 rounded-lg border-2 border-gray-200 bg-gray-100 p-2 disabled:cursor-not-allowed 2xl:min-h-[12lh]"
		>{assistant?.preprompt}</textarea
	>
</div>
