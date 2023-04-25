<script lang="ts">
	import { marked } from "marked";
	import privacy from "../../../PRIVACY.md?raw";
</script>

<div class="my-6 mt-12 mx-auto overflow-auto prose">
	{@html marked(privacy, { gfm: true })}
</div>
