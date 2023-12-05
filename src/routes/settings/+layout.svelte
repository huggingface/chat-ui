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
		class="z-10 grid h-[700px] max-h-[90dvh] w-[90dvw] content-start gap-x-10 gap-y-6 overflow-x-hidden rounded-2xl bg-white p-4 shadow-2xl outline-none max-sm:h-[90dvh] md:grid-cols-3 md:p-8 2xl:w-[1200px]"
	>
		<div class="flex items-center justify-between md:col-span-3">
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
			class="col-span-1 flex flex-col overflow-hidden whitespace-nowrap max-md:h-[200px] max-md:overflow-y-auto"
		>
			{#each data.models as model}
				<a
					href="{base}/settings/{model.id}"
					class="group flex h-11 flex-none items-center gap-3 rounded-xl pl-3 pr-2 text-gray-500 hover:bg-gray-100 {model.id ===
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
				class="group flex h-11 flex-none items-center gap-3 rounded-xl pl-3 pr-2 text-gray-500 hover:bg-gray-100 max-md:order-first"
			>
				<UserIcon class="pr-1 text-lg" />
				Application Settings
			</a>
		</div>
		<div class="md:col-span-2">
			<slot />
		</div>

		{#if $settings.recentlySaved}
			<div class="absolute bottom-0 right-0 m-2 inline p-2 text-gray-400">
				<CarbonCheckmark class="inline text-lg" />
				Saved
			</div>
		{/if}
	</dialog>
</div>
