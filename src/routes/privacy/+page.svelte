<script lang="ts">
	import type { PageData } from "./$types";

	export let data: PageData;

	let html = data.html;
</script>

<div class="mx-auto w-40 prose">
	<h1>Hello</h1>
	{@html html}
</div>
