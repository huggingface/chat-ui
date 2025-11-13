<script lang="ts">
	import { onMount } from "svelte";
	import privacy from "../../../PRIVACY.md?raw";

	let renderedHtml = $state<string>("");

	onMount(async () => {
		// Dynamically import marked to reduce initial bundle size
		// Privacy page is rarely accessed, so code-splitting makes sense
		const { marked } = await import("marked");
		renderedHtml = marked(privacy, { gfm: true });
	});
</script>

<div class="overflow-auto p-6">
	<div class="prose mx-auto px-4 pb-24 pt-6 dark:prose-invert md:pt-12">
		<!-- eslint-disable-next-line svelte/no-at-html-tags -->
		{@html renderedHtml}
	</div>
</div>
