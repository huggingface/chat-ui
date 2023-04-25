<script lang="ts">
	import { marked } from "marked";
	import privacy from "../../../PRIVACY.md?raw";
</script>

<div class="overflow-auto">
	<div class="mx-auto py-12 prose dark:prose-invert">
		{@html marked(privacy, { gfm: true })}
	</div>
</div>
