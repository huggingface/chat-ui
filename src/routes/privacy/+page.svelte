<script lang="ts">
	import { marked } from "marked";
	import privacy from "../../../PRIVACY.md?raw";
</script>

<div class="overflow-auto p-6">
	<div class="mx-auto prose px-4 pt-6 pb-24 md:pt-12 dark:prose-invert">
		<!-- eslint-disable-next-line svelte/no-at-html-tags -->
		{@html marked(privacy, { gfm: true })}
	</div>
</div>
