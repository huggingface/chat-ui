<script lang="ts">
	import { base } from "$app/paths";
	import { clickOutside } from "$lib/actions/clickOutside";
	import { afterNavigate, goto } from "$app/navigation";

	import { useSettingsStore } from "$lib/stores/settings";
	import type { PageData } from "./$types";
	import { applyAction, enhance } from "$app/forms";
	import { PUBLIC_APP_NAME, PUBLIC_ORIGIN } from "$env/static/public";
	import { page } from "$app/stores";

	export let data: PageData;

	let previousPage: string = base;

	afterNavigate(({ from }) => {
		if (!from?.url.pathname.includes("settings")) {
			previousPage = from?.url.pathname || previousPage;
		}
	});

	const settings = useSettingsStore();
</script>

<svelte:head>
	<meta property="og:title" content={data.assistant.name + " - " + PUBLIC_APP_NAME} />
	<meta property="og:type" content="link" />
	<meta
		property="og:description"
		content={`Use the ${data.assistant.name} assistant inside of ${PUBLIC_APP_NAME}`}
	/>
	<meta
		property="og:image"
		content="{PUBLIC_ORIGIN || $page.url.origin}{base}/assistant/{data.assistant._id}/thumbnail.png"
	/>
	<meta property="og:url" content={$page.url.href} />
	<meta name="twitter:card" content="summary_large_image" />
</svelte:head>

<div
	class="fixed inset-0 flex items-center justify-center bg-black/80 backdrop-blur-sm dark:bg-black/50"
>
	<dialog
		open
		use:clickOutside={() => {
			goto(previousPage);
		}}
		class="z-10 flex max-w-[90dvw] flex-col content-center items-center gap-x-10 gap-y-2 overflow-hidden rounded-2xl bg-white p-4 text-center shadow-2xl outline-none max-sm:px-6 md:w-96 md:grid-cols-3 md:grid-rows-[auto,1fr] md:p-8"
	>
		{#if data.assistant.avatar}
			<img
				class="size-16 flex-none rounded-full object-cover sm:size-24"
				src="{base}/settings/assistants/{data.assistant._id}/avatar?hash={data.assistant.avatar}"
				alt="avatar"
			/>
		{:else}
			<div
				class="flex size-24 flex-none items-center justify-center rounded-full bg-gray-300 font-bold uppercase text-gray-500"
			>
				{data.assistant.name[0]}
			</div>
		{/if}
		<h1 class="text-2xl font-bold">
			{data.assistant.name}
		</h1>
		<h3 class="text-balance text-sm text-gray-700">
			{data.assistant.description}
		</h3>
		{#if data.assistant.createdByName}
			<p class="text-sm text-gray-500">
				Created by <a
					class="hover:underline"
					href="https://hf.co/{data.assistant.createdByName}"
					target="_blank"
				>
					{data.assistant.createdByName}
				</a>
			</p>
		{/if}
		<button
			class="mt-4 w-full rounded-full bg-gray-200 px-4 py-2 font-semibold text-gray-700"
			on:click={() => {
				goto(previousPage);
			}}
		>
			Cancel
		</button>
		<form
			method="POST"
			action="{base}/settings/assistants/{data.assistant._id}?/subscribe"
			class="w-full"
			use:enhance={() => {
				return async ({ result }) => {
					// `result` is an `ActionResult` object
					if (result.type === "success") {
						$settings.activeModel = data.assistant._id;
						goto(`${base}`);
					} else {
						await applyAction(result);
					}
				};
			}}
		>
			<button
				type="submit"
				class=" w-full rounded-full bg-black px-4 py-3 font-semibold text-white"
			>
				Start chatting
			</button>
		</form>
	</dialog>
</div>
