<script lang="ts">
	import { marked } from "marked";
	import privacy from "../../../PRIVACY.md?raw";
</script>

<div class="my-6 overflow-auto">
	<div class="mx-auto pt-12 prose">
		<h1>Hello</h1>
		{@html marked(privacy, { gfm: true })}
	</div>
</div>
