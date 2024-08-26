<script lang="ts">
	import { onMount } from "svelte";
	import { base } from "$app/paths";
	import { afterNavigate, goto } from "$app/navigation";
	import { page } from "$app/stores";
	import { useSettingsStore } from "$lib/stores/settings";
	import CarbonClose from "~icons/carbon/close";
	import CarbonArrowUpRight from "~icons/carbon/ArrowUpRight";
	import CarbonAdd from "~icons/carbon/add";
	import CarbonTextLongParagraph from "~icons/carbon/text-long-paragraph";

	import UserIcon from "~icons/carbon/user";
	import type { LayoutData } from "../$types";

	export let data: LayoutData;

	let previousPage: string = base;
	let assistantsSection: HTMLHeadingElement;

	onMount(() => {
		if ($page.params?.assistantId) {
			assistantsSection.scrollIntoView();
		}
	});

	afterNavigate(({ from }) => {
		if (!from?.url.pathname.includes("settings")) {
			previousPage = from?.url.toString() || previousPage;
		}
	});

	const settings = useSettingsStore();
</script>

<div
	class="grid h-full w-full grid-cols-1 grid-rows-[auto,1fr] content-start gap-x-4 overflow-hidden p-4 md:grid-cols-3 md:grid-rows-[auto,1fr] md:p-8"
>
	<div class="col-span-1 mb-4 flex items-center justify-between md:col-span-3">
		<h2 class="text-xl font-bold">Settings</h2>
		<button
			class="btn rounded-lg"
			on:click={() => {
				goto(previousPage);
			}}
		>
			<CarbonClose class="text-xl text-gray-900 hover:text-black" />
		</button>
	</div>
	<div
		class="col-span-1 flex flex-col overflow-y-auto whitespace-nowrap max-md:-mx-4 max-md:h-[245px] max-md:border max-md:border-b-2 md:pr-6"
	>
		<h3 class="pb-3 pl-3 pt-2 text-[.8rem] text-gray-800 sm:pl-1">Models</h3>

		{#each data.models.filter((el) => !el.unlisted) as model}
			<a
				href="{base}/settings/{model.id}"
				class="group flex h-10 flex-none items-center gap-2 pl-3 pr-2 text-sm text-gray-500 hover:bg-gray-100 md:rounded-xl
					{model.id === $page.params.model ? '!bg-gray-100 !text-gray-800' : ''}"
			>
				<div class="mr-auto truncate">{model.displayName}</div>

				{#if $settings.customPrompts?.[model.id]}
					<CarbonTextLongParagraph
						class="size-6 rounded-md border border-gray-300 p-1 text-gray-800"
					/>
				{/if}
				{#if model.id === $settings.activeModel}
					<div
						class="rounded-lg bg-black px-2 py-1.5 text-xs font-semibold leading-none text-white"
					>
						Active
					</div>
				{/if}
			</a>
		{/each}
		<!-- if its huggingchat, the number of assistants owned by the user must be non-zero to show the UI -->
		{#if data.enableAssistants}
			<h3 bind:this={assistantsSection} class="pl-3 pt-5 text-[.8rem] text-gray-800 sm:pl-1">
				Assistants
			</h3>
			<!-- My Assistants -->
			<h4 class="py-2 pl-5 text-[.7rem] text-gray-600 sm:pl-1">My Assistants</h4>

			{#each data.assistants.filter((assistant) => assistant.createdByMe) as assistant}
				<a
					href="{base}/settings/assistants/{assistant._id.toString()}"
					class="group flex h-10 flex-none items-center gap-2 pl-2 pr-2 text-sm text-gray-500 hover:bg-gray-100 md:rounded-xl
					{assistant._id.toString() === $page.params.assistantId ? '!bg-gray-100 !text-gray-800' : ''}"
				>
					{#if assistant.avatar}
						<img
							src="{base}/settings/assistants/{assistant._id.toString()}/avatar.jpg?hash={assistant.avatar}"
							alt="Avatar"
							class="h-6 w-6 rounded-full"
						/>
					{:else}
						<div
							class="flex size-6 items-center justify-center rounded-full bg-gray-300 font-bold uppercase text-gray-500"
						>
							{assistant.name[0]}
						</div>
					{/if}
					<div class="truncate text-gray-900">{assistant.name}</div>
					{#if assistant._id.toString() === $settings.activeModel}
						<div
							class="ml-auto rounded-lg bg-black px-2 py-1.5 text-xs font-semibold leading-none text-white"
						>
							Active
						</div>
					{/if}
				</a>
			{/each}
			{#if !data.loginEnabled || (data.loginEnabled && !!data.user)}
				<a
					href="{base}/settings/assistants/new"
					class="group flex h-10 flex-none items-center gap-2 pl-3 pr-2 text-sm text-gray-500 hover:bg-gray-100 md:rounded-xl
				{$page.url.pathname === `${base}/settings/assistants/new` ? '!bg-gray-100 !text-gray-800' : ''}"
				>
					<CarbonAdd />
					<div class="truncate">Create new assistant</div>
				</a>
			{/if}

			<!-- Other Assistants -->
			<h4 class="pl-3 pt-3 text-[.7rem] text-gray-600 sm:pl-1">Other Assistants</h4>

			{#each data.assistants.filter((assistant) => !assistant.createdByMe) as assistant}
				<a
					href="{base}/settings/assistants/{assistant._id.toString()}"
					class="group flex h-10 flex-none items-center gap-2 pl-2 pr-2 text-sm text-gray-500 hover:bg-gray-100 md:rounded-xl
						{assistant._id.toString() === $page.params.assistantId ? '!bg-gray-100 !text-gray-800' : ''}"
				>
					{#if assistant.avatar}
						<img
							src="{base}/settings/assistants/{assistant._id.toString()}/avatar.jpg?hash={assistant.avatar}"
							alt="Avatar"
							class="h-6 w-6 rounded-full"
						/>
					{:else}
						<div
							class="flex size-6 items-center justify-center rounded-full bg-gray-300 font-bold uppercase text-gray-500"
						>
							{assistant.name[0]}
						</div>
					{/if}
					<div class="truncate">{assistant.name}</div>
					{#if assistant._id.toString() === $settings.activeModel}
						<div
							class="ml-auto rounded-lg bg-black px-2 py-1.5 text-xs font-semibold leading-none text-white"
						>
							Active
						</div>
					{/if}
				</a>
			{/each}
			<a
				href="{base}/assistants"
				class="group flex h-10 flex-none items-center gap-2 pl-3 pr-2 text-sm text-gray-500 hover:bg-gray-100 md:rounded-xl"
				><CarbonArrowUpRight class="mr-1.5 shrink-0 text-xs " />
				<div class="truncate">Browse Assistants</div>
			</a>
		{/if}

		<div class="my-2 mt-auto w-full border-b border-gray-200" />
		<a
			href="{base}/settings"
			class="group flex h-10 flex-none items-center gap-2 pl-3 pr-2 text-sm text-gray-500 hover:bg-gray-100 max-md:order-first md:rounded-xl
				{$page.url.pathname === `${base}/settings` ? '!bg-gray-100 !text-gray-800' : ''}"
		>
			<UserIcon class="text-sm" />
			Application Settings
		</a>
	</div>
	<div
		class="col-span-1 w-full overflow-y-auto overflow-x-clip px-1 max-md:pt-4 md:col-span-2 md:row-span-2"
	>
		<slot />
	</div>
</div>
