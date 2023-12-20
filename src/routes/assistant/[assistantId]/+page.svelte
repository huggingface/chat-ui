<script lang="ts">
	import { base } from "$app/paths";
	import { clickOutside } from "$lib/actions/clickOutside";
	import { browser } from "$app/environment";
	import { afterNavigate, goto } from "$app/navigation";

	import { useSettingsStore } from "$lib/stores/settings";
	import type { PageData } from "./$types";
	import { applyAction, enhance } from "$app/forms";

	export let data: PageData;

	let previousPage: string = base;

	afterNavigate(({ from }) => {
		if (!from?.url.pathname.includes("settings")) {
			previousPage = from?.url.pathname || previousPage;
		}
	});

	const settings = useSettingsStore();
</script>

<div
	class="fixed inset-0 flex items-center justify-center bg-black/80 backdrop-blur-sm dark:bg-black/50"
>
	<dialog
		open
		use:clickOutside={() => {
			if (browser) window;
			goto(previousPage);
		}}
		class="z-10 flex flex-col content-center items-center gap-x-10 gap-y-2 overflow-hidden rounded-2xl bg-white p-4 shadow-2xl outline-none md:grid-cols-3 md:grid-rows-[auto,1fr] md:p-8"
	>
		{#if data.assistant.avatar}
			<img
				class="h-24 w-24 rounded-full object-cover"
				src="{base}/settings/assistants/{data.assistant._id}/avatar"
				alt="avatar"
			/>
		{:else}
			<div
				class="flex h-24 w-24 items-center justify-center rounded-full bg-gray-300 font-bold text-gray-500"
			>
				{data.assistant.name[0].toLocaleUpperCase()}
			</div>
		{/if}
		<h1 class="text-2xl font-bold">
			{data.assistant.name}
		</h1>
		<h3 class="text-sm text-gray-700">
			{data.assistant.description}
		</h3>
		<p class="text-sm text-gray-500">
			Created by <a
				class="hover:underline"
				href="https://hf.co/{data.assistant.createdByName}"
				target="_blank"
			>
				{data.assistant.createdByName}
			</a>
		</p>

		<form
			method="POST"
			action="{base}/settings/assistants/{data.assistant._id}?/subscribe"
			use:enhance={(event) => {
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
			<button type="submit" class="rounded-lg bg-black px-3 py-1 text-white"> Add preset </button>
		</form>
	</dialog>
</div>
