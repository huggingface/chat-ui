<script lang="ts">
	import { afterUpdate } from 'svelte';
	import CopyToClipBoardBtn from './CopyToClipBoardBtn.svelte';

	export let code = '';
	export let lang = '';

	$: highlightedCode = '';

	afterUpdate(async () => {
		const { default: hljs } = await import('highlight.js');
		const language = hljs.getLanguage(lang);

		highlightedCode = hljs.highlightAuto(code, language?.aliases).value;
	});
</script>

<div class="group relative rounded-lg my-4">
	<pre class="overflow-auto px-5 py-3.5"><code class="language-{lang}"
			>{@html highlightedCode || code}</code
		></pre>
	<CopyToClipBoardBtn
		classNames="absolute top-2 right-2 invisible opacity-0 group-hover:visible group-hover:opacity-100"
		value={code}
	/>
</div>
