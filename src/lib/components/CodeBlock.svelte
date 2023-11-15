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
	{#if lang === "result"}
		<div class="rounded-lg bg-gray-700 p-4 text-xs">
			<div class="mb-1 text-gray-400">STDOUT/STDERR</div>
			<div class="prose flex flex-col-reverse text-white">
				{@html code
				.replaceAll("<", "&lt;")
				.replaceAll(">", "&gt;")
				.replaceAll("\n", "<br />")
				}
			</div>
		</div>
	{:else}
		<pre
			class="scrollbar-custom scrollbar-thumb-gray-500 hover:scrollbar-thumb-gray-400 dark:scrollbar-thumb-white/10 dark:hover:scrollbar-thumb-white/20 overflow-auto px-5"><code
				class="language-{lang}">{@html highlightedCode || code.replaceAll("<", "&lt;")}</code
			></pre>
		<CopyToClipBoardBtn
			classNames="absolute top-2 right-2 invisible opacity-0 group-hover:visible group-hover:opacity-100"
			value={code}
		/>
	{/if}
</div>
