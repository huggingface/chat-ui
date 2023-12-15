<script lang="ts">
	import { base } from "$app/paths";
	import { clickOutside } from "$lib/actions/clickOutside";
	import { browser } from "$app/environment";
	import { afterNavigate, goto } from "$app/navigation";
	import { page } from "$app/stores";
	import { useSettingsStore } from "$lib/stores/settings";
	import CarbonClose from "~icons/carbon/close";
	import CarbonCheckmark from "~icons/carbon/checkmark";

	import UserIcon from "~icons/carbon/user";
	export let data;

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
		class="xl: z-10 grid h-[95dvh] w-[90dvw] grid-cols-1 content-start gap-x-10 gap-y-6 overflow-hidden rounded-2xl bg-white p-4 shadow-2xl outline-none sm:h-[80dvh] md:grid-cols-3 md:grid-rows-[auto,1fr] md:p-8 xl:w-[1200px] 2xl:h-[70dvh]"
	>
		<div class="col-span-1 flex items-center justify-between md:col-span-3">
			<h2 class="text-xl font-bold">Settings</h2>
			<button
				class="btn rounded-lg"
				on:click={() => {
					if (browser) window;
					goto(previousPage);
				}}
			>
				<CarbonClose class="text-xl text-gray-900 hover:text-black" />
			</button>
		</div>
		<div
			class="col-span-1 flex flex-col overflow-y-auto whitespace-nowrap max-md:-mx-4 max-md:h-[245px] max-md:border md:pr-6"
		>
			{#each data.models.filter((el) => !el.unlisted) as model}
				<a
					href="{base}/settings/{model.id}"
					class="group flex h-11 flex-none items-center gap-3 pl-3 pr-2 text-gray-500 hover:bg-gray-100 md:rounded-xl {model.id ===
					$page.params.model
						? '!bg-gray-100 !text-gray-800'
						: ''}"
				>
					<div class="truncate">{model.displayName}</div>
					{#if model.id === $settings.activeModel}
						<div
							class="rounded-lg bg-black px-2 py-1.5 text-xs font-semibold leading-none text-white"
						>
							Active
						</div>
					{/if}
				</a>
			{/each}
			<a
				href="{base}/settings"
				class="group mt-auto flex h-11 flex-none items-center gap-3 pl-3 pr-2 text-gray-500 hover:bg-gray-100 max-md:order-first md:rounded-xl {$page
					.params.model === undefined
					? '!bg-gray-100 !text-gray-800'
					: ''}"
			>
				<UserIcon class="pr-1 text-lg" />
				Application Settings
			</a>
		</div>
		<div class="col-span-1 overflow-y-auto md:col-span-2">
			<slot />
		</div>

		{#if $settings.recentlySaved}
			<div
				class="absolute bottom-4 right-4 m-2 flex items-center gap-1.5 rounded-full border border-gray-300 bg-gray-200 px-3 py-1 text-black"
			>
				<CarbonCheckmark />
				Saved
			</div>
		{/if}
	</dialog>
</div>
