<script lang="ts">
	import { afterUpdate } from "svelte";
	import CopyToClipBoardBtn from "./CopyToClipBoardBtn.svelte";
	import HorizontalBarCharts from "./d3figure/HorizontalBarCharts.svelte";
	import DecisionTree from "./d3figure/DecisionTree.svelte";
	import ImagesBlock from "./ImagesBlock.svelte";
	import ExplainBlock from "./ExplainBlock.svelte";
	import ConceptGraphBlock from "./ConceptGraphBlock.svelte";
	function zip(arr1, arr2) {
		let length = Math.min(arr1.length, arr2.length);
		let result = [];

		for (let i = 0; i < length; i++) {
			result.push({ name: arr1[i], value: arr2[i] });
		}

		return result;
	}
	export let code = "";
	export let lang = "";
	export let parsedParams = {};
	const exceptionLangs = [
		"barchart",
		"decision-tree",
		"collapsible-div",
		"images",
		"image-with-mask",
		// "concept-graph",
	];

	$: highlightedCode = "";

	afterUpdate(async () => {
		const { default: hljs } = await import("highlight.js");
		if (exceptionLangs.includes(lang)) return;
		const language = hljs.getLanguage(lang);

		highlightedCode = hljs.highlightAuto(code, language?.aliases).value;
	});
	$: if (exceptionLangs.includes(lang)) {
		try {
			parsedParams = JSON.parse(code.replaceAll("'", '"'));
		} catch (e) {
			console.log("Error parsing JSON", code.replaceAll("'", '"'));
			console.error(e);
		}
	}
</script>

{#if lang == "barchart" && parsedParams["x"] && parsedParams["y"]}
	<div class="group max-w-[500px]">
		<HorizontalBarCharts
			data={zip(parsedParams["y"], parsedParams["x"])}
			xAxisLabel={parsedParams["x_label"]}
			yAxisLabel={parsedParams["y_label"]}
			title={parsedParams["title"]}
		/>
		<CopyToClipBoardBtn
			classNames="absolute top-2 right-2 invisible opacity-0 group-hover:visible group-hover:opacity-100"
			value={code}
		/>
	</div>
{:else if lang == "decision-tree"}
	<div class="group w-[500px]">
		<DecisionTree data={parsedParams} />
	</div>
{:else if lang == "images"}
	<div class="w-min-[500px] group w-full">
		<ImagesBlock json_data={parsedParams} />
	</div>
{:else if lang == "image-with-mask"}
	<ExplainBlock json_data={parsedParams} />
{:else if lang == "concept-graph"}
	<ConceptGraphBlock graph={parsedParams} />
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
