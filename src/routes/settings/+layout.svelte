<script lang="ts">
	import { base } from "$app/paths";
	import { clickOutside } from "$lib/actions/clickOutside";
	import { afterNavigate, goto } from "$app/navigation";
	import { useSettingsStore } from "$lib/stores/settings";
	import CarbonCheckmark from "~icons/carbon/checkmark";

	import { fade, fly } from "svelte/transition";

	let previousPage: string = base;

	afterNavigate(({ from }) => {
		if (!from?.url.pathname.includes("settings")) {
			previousPage = from?.url.toString() || previousPage;
		}
	});

	const settings = useSettingsStore();
</script>

<div
	class="fixed inset-0 z-20 flex items-center justify-center bg-black/80 backdrop-blur-sm dark:bg-black/50"
	in:fade
>
	<dialog
		in:fly={{ y: 100 }}
		open
		use:clickOutside={() => {
			if (window?.getSelection()?.toString()) {
				return;
			}
			goto(previousPage);
		}}
		class="h-[95dvh] w-[90dvw] overflow-hidden rounded-2xl bg-white shadow-2xl outline-none sm:h-[85dvh] xl:w-[1200px] 2xl:h-[75dvh]"
	>
		<slot />
		{#if $settings.recentlySaved}
			<div
				class="absolute bottom-4 right-4 m-2 flex items-center gap-1.5 rounded-full border border-gray-300 bg-gray-200 px-3 py-1 text-black"
			>
				<CarbonCheckmark class="text-green-500" />
				Saved
			</div>
		{/if}
	</dialog>
</div>
