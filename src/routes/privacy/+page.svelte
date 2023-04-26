<script lang="ts">
	import { marked } from "marked";
	import privacy from "../../../PRIVACY.md?raw";
</script>

<div class="p-6 overflow-auto">
	<div class="mx-auto pt-6 md:pt-12 pb-24 px-4 prose dark:prose-invert">
		{@html marked(privacy, { gfm: true })}
	</div>
</div>
