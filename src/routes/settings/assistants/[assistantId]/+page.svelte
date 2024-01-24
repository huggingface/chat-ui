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

	export let data: PageData;

	$: assistant = data.assistants.find((el) => el._id.toString() === $page.params.assistantId);

	const settings = useSettingsStore();

	$: isActive = $settings.activeModel === $page.params.assistantId;

	const prefix = PUBLIC_SHARE_PREFIX || `${PUBLIC_ORIGIN || $page.url.origin}${base}`;

	$: shareUrl = `${prefix}/assistant/${assistant?._id}`;
</script>

<div class="flex h-full flex-col gap-2">
	<div class="flex gap-6">
		{#if assistant?.avatar}
			<!-- crop image if not square  -->
			<img
				src={`${base}/settings/assistants/${assistant?._id}/avatar?hash=${assistant?.avatar}`}
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

		<div>
			<h1 class="text-xl font-semibold">
				{assistant?.name}
			</h1>

			{#if assistant?.description}
				<p class="pb-2 text-sm text-gray-500">
					{assistant.description}
				</p>
			{/if}

			<p class="text-sm text-gray-500">
				Model: <span class="font-semibold"> {assistant?.modelId} </span>
			</p>
			<button
				class="{isActive
					? 'bg-gray-100'
					: 'bg-black text-white'} my-2 flex w-fit items-center rounded-full px-3 py-1"
				disabled={isActive}
				name="Activate model"
				on:click|stopPropagation={() => {
					$settings.activeModel = $page.params.assistantId;
				}}
			>
				{isActive ? "Active" : "Activate"}
			</button>
		</div>
	</div>

	<div>
		<h2 class="text-lg font-semibold">Direct URL</h2>

		<p class="pb-2 text-sm text-gray-500">
			People with this link will be able to use your assistant.
			{#if !assistant?.createdByMe && assistant?.createdByName}
				Created by <a
					class="underline"
					target="_blank"
					href={"https://hf.co/" + assistant?.createdByName}
				>
					{assistant?.createdByName}
				</a>
			{/if}
		</p>

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

	<!-- <div>
		<h2 class="mb-2 text-lg font-semibold">Model used</h2>

		<div
			class="flex flex-row gap-2 rounded-lg border-2 border-gray-200 bg-gray-100 py-2 pl-3 pr-1.5"
		>
			<input disabled class="flex-1" value="Model" />
		</div>
	</div> -->

	<h2 class="mt-4 text-lg font-semibold">System Instructions</h2>

	<textarea
		disabled
		class="min-h-[8lh] w-full rounded-lg border-2 border-gray-200 bg-gray-100 p-2 2xl:min-h-[12lh]"
		>{assistant?.preprompt}</textarea
	>

	<div class="mt-5 flex gap-4">
		{#if assistant?.createdByMe}
			<a href="{base}/settings/assistants/{assistant?._id}/edit" class="underline"
				><CarbonPen class="mr-1.5 inline" />Edit assistant</a
			>
			<form method="POST" action="?/delete" use:enhance>
				<button type="submit" class="flex items-center underline">
					<CarbonTrash class="mr-1.5 inline" />Delete assistant</button
				>
			</form>
		{:else}
			<form method="POST" action="?/unsubscribe" use:enhance>
				<button type="submit" class="underline">
					<CarbonTrash class="mr-1.5 inline" />Remove assistant</button
				>
			</form>
			<form method="POST" action="?/edit" use:enhance class="hidden">
				<button type="submit" class="underline">
					<CarbonCopy class="mr-1.5 inline" />Duplicate assistant</button
				>
			</form>
			{#if !assistant?.reported}
				<form method="POST" action="?/report" use:enhance>
					<button type="submit" class="underline">
						<CarbonFlag class="mr-1.5 inline" />Report assistant</button
					>
				</form>
			{:else}
				<button type="button" disabled class="text-gray-700">
					<CarbonFlag class="mr-1.5 inline" />Reported</button
				>
			{/if}
		{/if}
	</div>
</div>
