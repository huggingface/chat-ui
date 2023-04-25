<script lang="ts">
	import { marked } from "marked";
	import privacy from "../../../PRIVACY.md?raw";
</script>

<div class="my-6 mt-12 mx-auto overflow-auto prose">
	<h1>Hello</h1>
	{@html marked(privacy)}
</div>
