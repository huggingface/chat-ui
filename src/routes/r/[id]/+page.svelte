<script lang="ts">
	import { onMount } from "svelte";
	import { goto } from "$app/navigation";
	import { base } from "$app/paths";
	import SharePreviewTags from "$lib/components/SharePreviewTags.svelte";

	let { data } = $props();

	let target = $derived(
		`${base}/conversation/${data.shareId}${data.leafId ? `?leafId=${encodeURIComponent(data.leafId)}` : ""}`
	);

	onMount(() => {
		goto(target, { replaceState: true });
	});
</script>

<SharePreviewTags
	shareId={data.shareId}
	title={data.title}
	messages={data.messages}
	rootMessageId={data.rootMessageId}
/>

<div class="flex h-full flex-col items-center justify-center gap-4 text-gray-500">
	<a href={target} class="underline hover:text-gray-700 dark:hover:text-gray-300">
		Open shared conversation
	</a>
</div>
