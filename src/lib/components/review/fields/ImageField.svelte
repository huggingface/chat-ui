<script lang="ts">
	import { imageUrl } from "$lib/utils/review/view";

	interface Props {
		value: string;
		clamp?: boolean;
	}

	let { value, clamp = false }: Props = $props();

	let src = $derived(imageUrl(value));
	let failed = $state(false);
</script>

{#if src && !failed}
	<img
		{src}
		alt={value}
		loading="lazy"
		class={[
			"rounded-lg border border-gray-100 object-contain dark:border-gray-800",
			clamp ? "max-h-20" : "max-h-96 max-w-full",
		]}
		onerror={() => (failed = true)}
	/>
{:else}
	<span class="font-mono text-xs break-all text-gray-500 dark:text-gray-400">
		{value}{failed ? " (could not load)" : ""}
	</span>
{/if}
