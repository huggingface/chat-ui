<script lang="ts">
	import type { PageData } from "./$types";

	export let data: PageData;

	let html = data.html;
</script>

<div class="my-6 mt-12 mx-auto overflow-auto prose">
	<h1>Hello</h1>
	{@html html}
</div>
