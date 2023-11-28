<script lang="ts">
	import { base } from "$app/paths";
	import { clickOutside } from "$lib/actions/clickOutside";
	import { browser } from "$app/environment";
	import { afterNavigate, goto } from "$app/navigation";
	import { page } from "$app/stores";
	import { useSettingsStore } from "$lib/stores/settings";
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
		class="z-10 w-[90dvw] max-w-4xl overflow-x-hidden rounded-2xl bg-white p-0 shadow-2xl outline-none transition-all"
	>
		<div class="grid h-full w-full grid-cols-4 gap-4">
			<div
				class="flex h-full max-h-[90dvh] w-full flex-col gap-4 overflow-y-auto bg-gray-200 p-4 pl-8 pt-8"
			>
				<h2 class="text-xl font-bold">Settings</h2>
				<h3 class="text-sm font-light">Models</h3>
				<div class="flex flex-col gap-2">
					{#each data.models as model}
						<a
							href="{base}/settings/{model.id}"
							class=" flex flex-row items-start gap-4 rounded-lg p-2 font-light transition-all"
							class:bg-gray-300={model.id === $page.params.model}
						>
							<span
								class="w-full truncate text-sm transition-all hover:underline"
								class:font-bold={model.id === $page.params.model}>{model.displayName}</span
							>
							{#if model.id === $settings.activeModel}
								<span class="rounded-lg bg-blue-600 p-1 text-xs font-semibold text-white"
									>Active</span
								>
							{/if}
						</a>
					{/each}
					<a
						href="{base}/settings"
						class="btn rounded-lg py-2"
						class:bg-gray-300={$page.params.model === undefined}
						class:font-bold={$page.params.model === undefined}>User Settings</a
					>
				</div>
			</div>
			<div class="col-span-3">
				<slot />
			</div>
		</div>
	</dialog>
</div>
