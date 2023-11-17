<script lang="ts">
	import { afterUpdate } from "svelte";
	import CopyToClipBoardBtn from "./CopyToClipBoardBtn.svelte";
	import ImageRender from "./ImageRender.svelte";

	export let code = "";
	export let lang = "";

	$: highlightedCode = "";

	afterUpdate(async () => {
		const { default: hljs } = await import("highlight.js");
		console.log("language", lang);
		if (lang === "{.ecole-image}") {
			highlightedCode = "";
		} else {
			const language = hljs.getLanguage(lang);
			highlightedCode = hljs.highlightAuto(code, language?.aliases).value;
			console.log("highlightedCode", highlightedCode);
		}
	});
	// vanillaJS
	function isJSON(str: string) {
		try {
			return JSON.parse(str) && !!str;
		} catch (e) {
			return false;
		}
	}
</script>

<div class="group relative my-4 rounded-lg">
	<!-- eslint-disable svelte/no-at-html-tags -->
	{#if (lang === "ecole-image" || lang === "{.ecole-image}") && isJSON(code)}
		{#if JSON.parse(code) instanceof Array}
			{#each JSON.parse(code) as json}
				<ImageRender {json} />
			{/each}
		{:else}
			<ImageRender json={JSON.parse(code)} />
		{/if}
	{:else}
		<pre
			class="scrollbar-custom overflow-auto px-5 scrollbar-thumb-gray-500 hover:scrollbar-thumb-gray-400 dark:scrollbar-thumb-white/10 dark:hover:scrollbar-thumb-white/20"><code
				class="language-{lang}">{@html highlightedCode || code.replaceAll("<", "&lt;")}</code
			></pre>
	{/if}
	<CopyToClipBoardBtn
		classNames="absolute top-2 right-2 invisible opacity-0 group-hover:visible group-hover:opacity-100"
		value={code}
	/>
</div>
