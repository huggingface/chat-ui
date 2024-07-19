<script lang="ts">
	import { onMount } from "svelte";
	import * as d3 from "d3";
	import dagreD3 from "dagre-d3";
	import { randomUUID } from "$lib/utils/randomUuid";

	let new_id = "id-" + randomUUID();

	const codeSample1 = `{
"concepts": [
{
"name": "afterburner",
"type": "component"
},
{
"name": "fighter jet",
"type": "normal"
},
{
"name": "passenger plane",
"type": "normal"
},
{
"name": "row of windows",
"type": "component"
},
{
"name": "wing-mounted engine",
"type": "component"
},
{
"name": "wings",
"type": "component"
},
{
"name": "airplane",
"type": "normal"
},
{
"name": "transport plane",
"type": "normal"
},
{
"name": "propulsion component",
"type": "component"
}
],
"containing_concepts": [
{
"source": "airplane",
"target": "transport plane",
"type": "containing"
},
{
"source": "airplane",
"target": "fighter jet",
"type": "containing"
},
{
"source": "transport plane",
"target": "passenger plane",
"type": "containing"
},
{
"source": "propulsion component",
"target": "wing-mounted engine",
"type": "containing"
},
{
"source": "propulsion component",
"target": "afterburner",
"type": "containing"
}
],
"component_concepts": [
{
"source": "fighter jet",
"target": "afterburner",
"type": "component"
},
{
"source": "fighter jet",
"target": "wings",
"type": "component"
},
{
"source": "passenger plane",
"target": "row of windows",
"type": "component"
},
{
"source": "passenger plane",
"target": "wing-mounted engine",
"type": "component"
},
{
"source": "passenger plane",
"target": "wings",
"type": "component"
},
{
"source": "airplane",
"target": "wings",
"type": "component"
},
{
"source": "airplane",
"target": "propulsion component",
"type": "component"
},
{
"source": "transport plane",
"target": "wing-mounted engine",
"type": "component"
},
{
"source": "transport plane",
"target": "wings",
"type": "component"
}
]
}`

	interface Concept {
		name: string;
		type: string;
	}

	interface Edge {
		source: string;
		target: string;
		type: string;
	}

	interface Graph{
		concepts: Concept[];
		containing_concepts: Edge[];
	}

	let loading = true;

	let codeSample = JSON.parse(codeSample1);

	onMount(() => generateGraph());

	function generateGraph() {
		const g = new dagreD3.graphlib.Graph().setGraph({rankdir: 'TB', ranksep: 70});

		// Add nodes to the graph
		codeSample.concepts.forEach((concept: Concept) => {
			const fill = concept.type === "component" ? "#f7d4d4" : "#cce0ff";
			const stroke = concept.type === "component" ? "#e77e7e" : "#4d94ff";
			g.setNode(concept.name, { label: concept.name, shape: "ellipse", style: `fill: ${fill}; stroke: ${stroke};`, padding: 20, class: "text-[20px]" });
		});

		// Add containing edges to the graph
		codeSample.containing_concepts.forEach((edge: Edge) => {
				g.setEdge(edge.source, edge.target, {style: "stroke: #4d94ff; stroke-width: 2; fill: none", arrowheadStyle: "arrowhead-blue"});
		});

		// Add component edges to the graph
		codeSample.component_concepts.forEach((edge : Edge) => {
			g.setEdge(edge.source, edge.target, {style: "stroke: #e77e7e; stroke-width: 2px; fill: none" , arrowheadStyle: "arrowhead-red"});
		});

		// Create the renderer
		const render = new dagreD3.render();

		// Custom linkArc function for straight lines
		function linkArc(d: dagreD3.graphlib.Edge, i: number) {
			const source = g.node(d.v);
			const target = g.node(d.w);
			const dx = (target.x - source.x)/15;
      return `M${source.x},${source.y}L${target.x-dx},${target.y-30}`;
		}

		// Set up an SVG group so that we can translate the final graph.
		const svg = d3.select(`#${new_id}`),
		inner = svg.append("g");

		// Add marker definitions for arrowheads
		svg.append("defs").selectAll("marker")
				.data(["arrowhead-blue", "arrowhead-red"])
				.enter()
				.append("marker")
				.attr("id", d => d)
				.attr("viewBox", "0 -5 10 10")
				.attr("refX", 10)
				.attr("refY", 0)
				.attr("markerWidth", 6)
				.attr("markerHeight", 6)
				.attr("orient", "auto")
				.append("path")
				.attr("d", "M0,-5L10,0L0,5")
				.attr("fill", d => d === 'arrowhead-red' ? '#ff3333' : '#0066ff');
					
		// Set up zoom support
		const zoom = d3.zoom()
				.on("zoom", function(e) {
					inner.attr("transform", e.transform);
				});

		svg.call(zoom as any);
		
		// Run the renderer. This is what draws the final graph.
		render(inner as any, g as any);
		loading = false;

		// Apply linkArc to all edges
    inner.selectAll('.edgePath path').attr('d', (d,i) => linkArc(d as dagreD3.graphlib.Edge,i)).attr('marker-end', function(d) { return `url(#${g.edge(d as dagreD3.graphlib.Edge).arrowheadStyle})`; });

		const graph = g.graph() as unknown as dagreD3.graphlib.Graph & { width: number, height: number };

		// Center the graph
		const initialScale = 0.75;
		svg.call(zoom.transform as any, d3.zoomIdentity.translate((+svg.attr("width") - graph.width * initialScale) / 2 + 50, 80).scale(initialScale));

		// Add a legend
		const legendData = [
			{ label: "Concept", color: "#cce0ff", stroke: "#4d94ff" },
			{ label: "Component Concept", color: "#f7d4d4", stroke: "#e77e7e"},
			{ label: "Instance Relation", color: "#4d94ff", type: "line", stroke: "" },
			{ label: "Component Relation", color: "#e77e7e", type: "line", stroke: "" }
		];

		const legend = svg.append("g")
			.attr("transform", `translate(20, 20)`);
			
		// Add a background rectangle
		const background = legend.append("rect")
			.attr("x", -20)
			.attr("y", -20)
			.attr("width", 220)  // You can adjust these values to match your SVG's size
			.attr("height", 150)  // You can adjust these values to match your SVG's size
			.attr("rx", 10)
			.attr("fill", "#f0f0f0")
			.attr("stroke", "#b5b3b3");
			

		legend.selectAll("ellipse")
			.data([legendData[0], legendData[1]])
			.enter()
			.append("ellipse")
			.attr("cx", 20)
			.attr("cy", (d, i) => i * 35 + 9)
			.attr("rx", 30)
			.attr("ry", 15)
			.attr("fill", function(d) { return d.color; })
			.attr("stroke", function(d) { return d.stroke; });

		legend.selectAll("line")
			.data([legendData[2], legendData[3]])
			.enter()
			.append("line")
			.attr("x1", -5)
			.attr("y1", (d, i) => i*30 + 75)
			.attr("x2", 45)
			.attr("y2", (d, i) => i*30 + 75)
			.attr("stroke", d => d.color)
			.attr("stroke-width", 2)

		legend.selectAll("text")
			.data(legendData)
			.enter()
			.append("text")
			.attr("x", 70)
			.attr("y", (d, i) => i * 32 + 15)
			.attr("text-anchor", "left")
			.text(d => d.label)
			.attr("class", "text-[12px] font-medium");
	};

</script>

<div class="dark:bg-[#f0f0f0] rounded">
	{#if loading}
		<p class="text-gray-600 dark:text-gray-300">Loading...</p>
	{/if}
	<svg  id={new_id} width="786" height="500" />
</div>

<style>
</style>
