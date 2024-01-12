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
	import CarbonFollow from "~icons/carbon/user-follow";
	import CopyToClipBoardBtn from "$lib/components/CopyToClipBoardBtn.svelte";

	export let data: PageData;

	$: assistant = data.assistants.find((el) => el._id.toString() === $page.params.assistantId);

	const settings = useSettingsStore();

	$: isActive = $settings.activeModel === $page.params.assistantId;

	const prefix = PUBLIC_SHARE_PREFIX || `${PUBLIC_ORIGIN || $page.url.origin}${base}`;

	$: shareUrl = `${prefix}/assistant/${assistant?._id}`;
</script>

<div class="flex h-full flex-col gap-2">
	<div class="flex flex-row gap-8">
		{#if assistant?.avatar}
			<!-- crop image if not square  -->
			<img
				src={`${base}/settings/assistants/${assistant?._id}/avatar?hash=${assistant?.avatar}`}
				alt="Avatar"
				class="h-24 w-24 rounded-full object-cover"
			/>
		{:else}
			<div
				class="flex h-24 w-24 items-center justify-center rounded-full bg-gray-300 text-4xl font-bold uppercase text-gray-500"
			>
				{assistant?.name[0]}
			</div>
		{/if}

		<div>
			<h1 class="text-xl font-bold">
				{assistant?.name}
			</h1>

			<p class="pb-2 text-sm text-gray-500">
				{assistant?.description}
			</p>

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
				{isActive ? "Active model" : "Activate"}
			</button>
		</div>
	</div>

	<div>
		<h2 class="text-lg font-bold">Direct URL</h2>

		<p class="pb-2 text-sm text-gray-500">
			{#if assistant?.createdByMe}
				By sharing this URL, other people can use your assistant.
			{:else}
				Created by <a
					class=" hover:underline"
					target="_blank"
					href={"https://hf.co/" + assistant?.createdByName}
				>
					<CarbonFollow class="inline" />
					{assistant?.createdByName}
				</a>
			{/if}
		</p>

		<div class="flex flex-row gap-2 rounded-full border-2 border-gray-200 bg-gray-100">
			<input disabled class="w-full px-3 py-1" value={shareUrl} />
			<CopyToClipBoardBtn value={shareUrl} classNames="border-0 text-gray-500 text-lg mr-4" />
		</div>
	</div>

	<h2 class="text-lg font-bold">System Instructions</h2>

	<textarea disabled class="w-full rounded-lg border-2 border-gray-200 bg-gray-100 p-2"
		>{assistant?.preprompt}</textarea
	>

	<div class="mt-5 flex w-full flex-row justify-around gap-4">
		{#if assistant?.createdByMe}
			<form method="POST" action="?/delete" use:enhance>
				<button type="submit" class="flex items-center underline">
					<CarbonTrash class="mr-1.5 inline" />
					Delete assistant</button
				>
			</form>
			<a href="{base}/settings/assistants/{assistant?._id}/edit" class="underline">
				<CarbonPen class="mr-1.5 inline" />
				Edit assistant
			</a>
		{:else}
			<form method="POST" action="?/unsubscribe" use:enhance>
				<button type="submit" class="underline">
					<CarbonTrash class="mr-1.5 inline" />
					Remove assistant</button
				>
			</form>
			<form method="POST" action="?/edit" use:enhance class="hidden">
				<button type="submit" class="underline">
					<CarbonCopy class="mr-1.5 inline" />
					Duplicate assistant</button
				>
			</form>
			{#if !assistant?.reported}
				<form method="POST" action="?/report" use:enhance>
					<button type="submit" class="underline">
						<CarbonFlag class="mr-1.5 inline" />
						Report assistant</button
					>
				</form>
			{:else}
				<button type="button" disabled class="text-gray-700">
					<CarbonFlag class="mr-1.5 inline" />
					Reported</button
				>
			{/if}
		{/if}
	</div>
</div>
