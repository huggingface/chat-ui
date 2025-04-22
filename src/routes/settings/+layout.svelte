<script lang="ts">
	import { base } from "$app/paths";
	import { afterNavigate, goto } from "$app/navigation";
	import { useSettingsStore } from "$lib/stores/settings";
	import CarbonCheckmark from "~icons/carbon/checkmark";

	import Modal from "$lib/components/Modal.svelte";

	interface Props {
		children?: import("svelte").Snippet;
	}

	let { children }: Props = $props();

	let previousPage: string = $state(base || "/");

	afterNavigate(({ from }) => {
		if (from?.url && !from.url.pathname.includes("settings")) {
			previousPage = from.url.toString() || previousPage || base || "/";
		}
	});

	const settings = useSettingsStore();
</script>

<Modal
	on:close={() => goto(previousPage)}
	width="h-[95dvh] w-[90dvw] pb-0 overflow-hidden rounded-2xl bg-white shadow-2xl outline-none sm:h-[95dvh] xl:w-[1200px] 2xl:h-[75dvh]"
>
	{@render children?.()}
	{#if $settings.recentlySaved}
		<div
			class="absolute bottom-4 right-4 m-2 flex items-center gap-1.5 rounded-full border border-gray-300 bg-gray-200 px-3 py-1 text-black"
		>
			<CarbonCheckmark class="text-green-500" />
			Saved
		</div>
	{/if}
</Modal>
