<script lang="ts">
	import { afterUpdate } from "svelte";
	import CopyToClipBoardBtn from "./CopyToClipBoardBtn.svelte";

	export let code = "";
	export let lang = "";

	$: highlightedCode = "";

	afterUpdate(async () => {
		const { default: hljs } = await import("highlight.js");
		const language = hljs.getLanguage(lang);

		highlightedCode = hljs.highlightAuto(code, language?.aliases).value;
	});
</script>

<div class="group relative my-4 rounded-lg">
	<!-- eslint-disable svelte/no-at-html-tags -->
	<pre
		class="scrollbar-custom overflow-auto px-5 scrollbar-thumb-gray-500 hover:scrollbar-thumb-gray-400 dark:scrollbar-thumb-white/10 dark:hover:scrollbar-thumb-white/20"><code
			class="language-{lang}">{@html highlightedCode || code.replaceAll("<", "&lt;")}</code
		></pre>
	<CopyToClipBoardBtn
		classNames="absolute top-2 right-2 invisible opacity-0 group-hover:visible group-hover:opacity-100"
		value={code}
	/>
</div>
