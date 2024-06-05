<script>
	import { onMount } from "svelte";
	import * as d3 from "d3";
	import { v4 as uuid } from "uuid";
	import { draw } from "svelte/transition";
	let element;
	let windowWidth = 0;
	let resizeObserver = null;
	const id = "pie-chart-" + uuid();

	// Define your data here
	export let data = [
		{ name: "Segment A", value: 10 },
		{ name: "Segment B", value: 20 },
		// ... more data
	];
	// Calculate the total value of all segments
	const total = data.reduce((sum, d) => sum + d.value, 0);

	// Format a number as a percentage
	function formatPercent(number) {
		return d3.format(".1%")(number / total);
	}
	function formatLabel(d) {
		return `${d.data.name}: ${formatPercent(d.data.value)}`;
	}

	// Function to wrap text
	function wrap(text, width, x = 0) {
		text.each(function () {
			var text = d3.select(this),
				words = text.text().split(/\s+/).reverse(),
				word,
				line = [],
				lineNumber = 0,
				lineHeight = 1.1, // ems
				y = text.attr("y"),
				dy = parseFloat(text.attr("dy")),
				tspan = text
					.text(null)
					.append("tspan")
					.attr("x", x)
					.attr("y", y)
					.attr("dy", dy + "em");

			while ((word = words.pop())) {
				line.push(word);
				tspan.text(line.join(" "));
				if (tspan.node().getComputedTextLength() > width) {
					line.pop();
					tspan.text(line.join(" "));
					line = [word];
					tspan = text
						.append("tspan")
						.attr("x", x)
						.attr("y", y)
						.attr("dy", ++lineNumber * lineHeight + dy + "em")
						.text(word);
				}
			}
		});
	}
	onMount(() => {
		resizeObserver = new ResizeObserver((entries) => {
			for (let entry of entries) {
				windowWidth = entry.contentRect.width;
			}
		});

		resizeObserver.observe(element);

		return () => {
			resizeObserver.disconnect();

			resizeObserver = null;

			windowWidth = 0;

			d3.select("#" + id)
				.selectAll("*")
				.remove();
		};
	});
	const drawChart = (inputWidth) => {
		const width = inputWidth - 10;
		const height = width;
		const radius = Math.min(width, height) / 2;

		const svg = d3
			.select("#" + id)
			.append("svg")
			.attr("width", width)
			.attr("height", height)
			.append("g")
			.attr("transform", "translate(" + width / 2 + "," + height / 2 + ")");

		const pie = d3.pie().value((d) => d.value);
		const arc = d3.arc().innerRadius(0).outerRadius(radius);

		const labelArc = d3
			.arc()
			.innerRadius(radius / 2)
			.outerRadius(radius);

		const tooltip = d3.select("#pie-chart-tooltip" + id);

		svg
			.selectAll("path")
			.data(pie(data))
			.enter()
			.append("path")
			.attr("d", arc)
			.attr("fill", (d, i) => d3.schemeCategory10[i % 10])
			.on("mouseover", (event, d) => {
				tooltip.transition().duration(200).style("opacity", 0.9);
				tooltip
					.html(d.data.name + ": " + d.data.value)
					.style("left", event.pageX + 10 + "px")
					.style("top", event.pageY - 10 + "px");
			})
			.on("mouseout", () => {
				tooltip.transition().duration(500).style("opacity", 0);
			});

		svg
			.selectAll("text")
			.data(pie(data))
			.enter()
			.append("text")
			.attr("transform", (d) => "translate(" + labelArc.centroid(d) + ")")
			.attr("dy", "0.35em")
			.style("text-anchor", "middle")
			.style("font-size", "10px")
			.style("fill", "white")
			.text(formatLabel)
			.call(wrap, radius / 2); // Adjust width as needed
	};
	$: if (windowWidth != 0) {
		drawChart(windowWidth);
	}
</script>

<div class="w-full" bind:this={element}>
	<div {id} />
	<div id={"pie-chart-tooltip" + id} class="tooltip" style="opacity: 0;" />
</div>

<style>
	.tooltip {
		position: fixed;
		text-align: center;
		padding: 8px;
		font: 12px sans-serif;
		background: black;
		color: white;
		opacity: 0.8;
		border: 0px;
		border-radius: 8px;
		pointer-events: none;
	}
</style>
