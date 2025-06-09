<script lang="ts">
	import { onMount } from "svelte";
	import { base } from "$app/paths";
	import { afterNavigate, goto, invalidateAll } from "$app/navigation";
	import { page } from "$app/state";
	import { useSettingsStore } from "$lib/stores/settings";
	import CarbonClose from "~icons/carbon/close";
	import CarbonArrowUpRight from "~icons/carbon/ArrowUpRight";
	import CarbonAdd from "~icons/carbon/add";
	import CarbonTextLongParagraph from "~icons/carbon/text-long-paragraph";
	import CarbonChevronLeft from "~icons/carbon/chevron-left";

	import UserIcon from "~icons/carbon/user";
	import type { LayoutData } from "../$types";
	import { error } from "$lib/stores/errors";
	import { browser } from "$app/environment";
	import { isDesktop } from "$lib/utils/isDesktop";
	import { debounce } from "$lib/utils/debounce";

	import { fly } from "svelte/transition";
	import { handleResponse, useAPIClient } from "$lib/APIClient";

	interface Props {
		data: LayoutData;
		children?: import("svelte").Snippet;
	}

	let { data, children }: Props = $props();

	let previousPage: string = $state(base || "/");
	let assistantsSection: HTMLHeadingElement | undefined = $state();
	let showContent: boolean = $state(false);

	const client = useAPIClient();

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
		if (page.params?.assistantId && assistantsSection) {
			assistantsSection.scrollIntoView();
		}
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
			in:fly={{ x: -100, duration: 200 }}
			out:fly={{ x: -100, duration: 200 }}
		>
			<!-- Section Headers -->
			<h3
				class="px-4 pb-2 pt-3 text-center text-[.8rem] font-medium text-gray-800 md:px-3 md:text-left"
			>
				Models
			</h3>

			{#each data.models.filter((el) => !el.unlisted) as model}
				<button
					type="button"
					onclick={() => goto(`${base}/settings/${model.id}`)}
					class="group flex h-10 w-full flex-none items-center gap-2 px-4 text-sm text-gray-500 hover:bg-gray-100 md:rounded-xl md:px-3
					{model.id === page.params.model ? '!bg-gray-100 !text-gray-800' : ''}"
					aria-label="Configure {model.displayName}"
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
				</button>
			{/each}
			{#if data.enableAssistants}
				<h3
					bind:this={assistantsSection}
					class="mt-6 px-4 pb-2 text-center text-[.8rem] font-medium text-gray-800 md:px-3 md:text-left"
				>
					Assistants
				</h3>
				<!-- My Assistants -->
				<h4
					class="px-4 pb-1 pt-2 text-center text-[.7rem] font-medium text-gray-600 md:px-3 md:text-left"
				>
					My Assistants
				</h4>

				{#each data.assistants.filter((assistant) => assistant.createdByMe) as assistant}
					<button
						type="button"
						onclick={() => goto(`${base}/settings/assistants/${assistant._id.toString()}`)}
						class="group flex h-10 w-full flex-none items-center gap-2 px-4 text-sm text-gray-500 hover:bg-gray-100 md:rounded-xl md:px-3
						{assistant._id.toString() === page.params.assistantId ? '!bg-gray-100 !text-gray-800' : ''}"
						aria-label="Configure {assistant.name} assistant"
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
					</button>
				{/each}
				{#if !data.loginEnabled || (data.loginEnabled && !!data.user)}
					<button
						type="button"
						onclick={() => goto(`${base}/settings/assistants/new`)}
						class="group flex h-10 w-full flex-none items-center gap-2 px-4 text-sm text-gray-500 hover:bg-gray-100 md:rounded-xl md:px-3
						{page.url.pathname === `${base}/settings/assistants/new` ? '!bg-gray-100 !text-gray-800' : ''}"
						aria-label="Create new assistant"
					>
						<CarbonAdd />
						<div class="truncate">Create new assistant</div>
					</button>
				{/if}

				<!-- Other Assistants -->
				<h4
					class="mt-4 px-4 pb-1 pt-2 text-center text-[.7rem] font-medium text-gray-600 md:px-3 md:text-left"
				>
					Other Assistants
				</h4>

				{#each data.assistants.filter((assistant) => !assistant.createdByMe) as assistant}
					<div class="group relative">
						<button
							type="button"
							onclick={() => goto(`${base}/settings/assistants/${assistant._id.toString()}`)}
							class="group flex h-10 w-full flex-none items-center gap-2 px-4 text-sm text-gray-500 hover:bg-gray-100 md:rounded-xl md:px-3
							{assistant._id.toString() === page.params.assistantId ? '!bg-gray-100 !text-gray-800' : ''}"
							aria-label="Configure {assistant.name} assistant"
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
						</button>
						<div class="absolute right-2 top-1/2 -translate-y-1/2">
							<button
								type="button"
								aria-label="Remove assistant from your list"
								class={[
									"rounded-full p-1 text-xs hover:bg-gray-500 hover:bg-opacity-20",
									assistant._id.toString() === page.params.assistantId
										? "block"
										: "hidden group-hover:block",
									assistant._id.toString() !== $settings.activeModel && "ml-auto",
								]}
								onclick={(event) => {
									event.stopPropagation();
									client
										.assistants({
											id: assistant._id,
										})
										.follow.delete()
										.then(handleResponse)
										.then(() => {
											if (assistant._id.toString() === page.params.assistantId) {
												goto(`${base}/settings`, { invalidateAll: true });
											} else {
												invalidateAll();
											}
										})
										.catch((err) => {
											console.error(err);
											$error = err.message;
										});
								}}
							>
								<CarbonClose class="size-4 text-gray-500" />
							</button>
						</div>
					</div>
				{/each}
				<button
					type="button"
					onclick={() => goto(`${base}/assistants`)}
					class="group flex h-10 w-full flex-none items-center gap-2 px-4 text-sm text-gray-500 hover:bg-gray-100 md:rounded-xl md:px-3"
					aria-label="Browse all assistants"
				>
					<CarbonArrowUpRight class="mr-1.5 shrink-0 text-xs" />
					<div class="truncate">Browse Assistants</div>
				</button>
			{/if}

			<div class="my-2 mt-auto w-full border-b border-gray-200"></div>
			<button
				type="button"
				onclick={() => goto(`${base}/settings/application`)}
				class="group flex h-10 w-full flex-none items-center gap-2 px-4 text-sm text-gray-500 hover:bg-gray-100 max-md:order-first md:rounded-xl md:px-3
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
			in:fly={{ x: 100, duration: 200 }}
			out:fly={{ x: 100, duration: 200 }}
		>
			{@render children?.()}
		</div>
	{/if}
</div>
