<script>
	import { onMount } from "svelte";
	import * as d3 from "d3";
	import dagreD3 from "dagre-d3";
	import { randomUUID } from "$lib/utils/randomUuid";

	let new_id = randomUUID();
	export let graph = {
		concepts: [
			{ name: "afterburner", type: "component" },
			{ name: "ammunition belt", type: "component" },
			// Add more concepts here...
		],
		containing_concepts: [
			{ source: "afterburner", target: "fighter jet", type: "containing" },
			{ source: "ammunition belt", target: "machine gun", type: "containing" },
			// Add more edges here...
		],
		component_concepts: [
			{ source: "fighter jet", target: "airplane", type: "component" },
			{ source: "machine gun", target: "gun", type: "component" },
			// Add more edges here...
		],
	};

	onMount(() => {
		const g = new dagreD3.graphlib.Graph().setGraph({});

		// Add nodes to the graph
		graph.concepts.forEach((concept) => {
			const shape = concept.type === "component" ? "triangle" : "circle";
			const fill = concept.type === "component" ? "red" : "blue";
			g.setNode(concept.name, { label: concept.name, shape, style: `fill: ${fill}` });
		});

		// Add containing edges to the graph
		graph.containing_concepts.forEach((edge) => {
			g.setEdge(edge.source, edge.target, { style: "stroke: black; fill: none" });
		});

		// Add component edges to the graph
		graph.component_concepts.forEach((edge) => {
			g.setEdge(edge.source, edge.target, {
				style: "stroke: red; stroke-dasharray: 5, 5; fill: none",
			});
		});

		// Create the renderer
		const render = new dagreD3.render();

		// Set up an SVG group so that we can translate the final graph.
		const svg = d3.select(`#${new_id}`),
			svgGroup = svg.append("g");

		console.log(svgGroup);
		console.log(g);
		// Run the renderer. This is what draws the final graph.
		render(d3.select(`#${new_id} g`), g);

		// Center the graph
		const xCenterOffset = (svg.attr("width") - g.graph().width) / 2;
		svgGroup.attr("transform", `translate(${xCenterOffset}, 20)`);
		svg.attr("height", g.graph().height + 40);
	});
</script>

<svg id={new_id} width="800" height="600" />

<style>
	.node circle {
		stroke: #999;
		stroke-width: 1.5px;
	}

	.node polygon {
		stroke: #999;
		stroke-width: 1.5px;
	}

	.edgePath path {
		stroke-width: 2px;
	}
</style>
