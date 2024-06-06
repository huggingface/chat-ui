<script>
	import * as d3 from "d3";
	import { onMount } from "svelte";
	import { v4 as uuid } from "uuid";

	export let data = [
		{ concept_name: "airplane", score: 1.6099824905395508, parent: null, id: "root" },
		{ concept_name: "propulsion component", score: -2.2690000534057617, parent: null, id: "root" },
		{ concept_name: "wings", score: -3.665599822998047, parent: null, id: "root" },
		{ concept_name: "row of windows", score: -15.156801223754883, parent: null, id: "root" },
		{
			concept_name: "fighter jet",
			score: 4.637862205505371,
			parent: "airplane",
			id: "8512aeda-b5e9-4c1f-b60f-4af5fcf6bc84",
		},
		{
			concept_name: "transport plane",
			score: -15.757169723510742,
			parent: "airplane",
			id: "3bb60804-9b36-4782-91a4-ab44b794e2d1",
		},
	];
	let id = uuid();
	let svg;
	const width = 800;
	const height = 600;

	function createGraph() {
		// Convert flat data to hierarchical format
		data.push({ concept_name: "root", score: 0, parent: null, id: "root" });
		const rootData = d3
			.stratify()
			.id((d) => d.concept_name)
			.parentId((d) => d.parent)(data);

		const root = d3.hierarchy(rootData, (d) => d.children).sum((d) => d.data.score);

		const treeLayout = d3.tree().size([height, width - 200]); // Note the swapped dimensions

		treeLayout(root);

		const svgElement = d3
			.select(svg)
			.attr("viewBox", `0 0 ${width} ${height}`)
			.style("width", "100%")
			.style("height", "auto");
		// Links
		svgElement
			.selectAll(".link")
			.data(root.links().filter((d) => d.source.parent !== null))
			.enter()
			.append("path")
			.attr("class", "link")
			.attr(
				"d",
				d3
					.linkHorizontal()
					.x((d) => d.y)
					.y((d) => d.x)
			)
			.attr("stroke-width", (d) => Math.max(1.5, Math.abs(4 * d.target.data.data.score)))
			.attr("fill", "none")
			.attr("stroke", "#999");

		// Nodes
		const node = svgElement
			.selectAll(".node")
			.data(root.descendants().filter((d) => d.parent !== null))
			.enter()
			.append("g")
			.attr("class", "node")
			.attr("transform", (d) => `translate(${d.y},${d.x})`);

		node
			.append("circle")
			.attr("r", (d) => Math.max(d.value * 10, 2))
			.attr("fill", "#69b3a2");

		node
			.append("text")
			.attr("dx", 0)
			.attr("dy", 40)
			.attr("text-anchor", "middle")
			.attr("text-align", "center")
			.text((d) => `${d.data.data.concept_name}\n(${d.data.data.score.toFixed(2)})`);

		node
			.append("title")
			.text((d) => `${d.data.data.concept_name}: ${d.data.data.score.toFixed(2)}`);
	}

	onMount(() => {
		createGraph();
	});
</script>

<svg bind:this={svg} {id} />

<style>
	.link {
		fill: none;
		stroke: #999;
		stroke-opacity: 0.6;
	}
	.node circle {
		fill: blue;
	}
	.node text {
		font: 10px sans-serif;
	}
</style>
