<script lang="ts">
	import { afterUpdate } from "svelte";
	import CopyToClipBoardBtn from "./CopyToClipBoardBtn.svelte";
	import HorizontalBarCharts from "./d3figure/HorizontalBarCharts.svelte";
	function zip(arr1, arr2) {
		let length = Math.min(arr1.length, arr2.length);
		let result = [];

		for (let i = 0; i < length; i++) {
			result.push([arr1[i], arr2[i]]);
		}

		return result;
	}
	export let code = "";
	export let lang = "";
	export let parsedParams = {};

	$: highlightedCode = "";

	afterUpdate(async () => {
		const { default: hljs } = await import("highlight.js");
		if (lang === "barchart") {
			parsedParams = JSON.parse(code);
			console.log("barchart", parsedParams);
			return;
		}
		const language = hljs.getLanguage(lang);

		highlightedCode = hljs.highlightAuto(code, language?.aliases).value;
	});
</script>

{#if lang == "barchart"}
	<div class="group relative my-4 rounded-lg">
		<HorizontalBarCharts
			data={zip(parsedParams["y"], parsedParams["x"])}
			xAxisLabel={parsedParams["x_label"]}
			yAxisLabel={parsedParams["y_label"]}
		/>
		<CopyToClipBoardBtn
			classNames="absolute top-2 right-2 invisible opacity-0 group-hover:visible group-hover:opacity-100"
			value={code}
		/>
	</div>
{:else}
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
{/if}
