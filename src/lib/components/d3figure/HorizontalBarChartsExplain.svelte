<script>
	import { onMount } from "svelte";
	import * as d3 from "d3";
	import { v4 as uuid } from "uuid";

	// Sample data
	export let data = [
		{ name: "Category A", value: 30 },
		{ name: "Category B", value: 80 },
		{ name: "Category C", value: 45 },
		// ... more categories
	];

	// Axis labels
	export let xAxisLabel = "Scores";
	export let yAxisLabel = "Attributes";
	export let name = "Graph Name";
	// Define the value where you want the horizontal line to be drawn
	export let lineValue = null; // Replace 'someValue' with the actual value

	let id = "-" + uuid();
	let windowWidth = 400;
	let element;

	// Fixed x-axis values
	export let fixedXAxis = false;
	export let xFixedValues = [0, 1];
	function wrapText(text, width) {
		text.each(function () {
			var new_text = d3.select(this),
				words = new_text.text().split(/\s+/).reverse(),
				word,
				line = [],
				lineNumber = 0,
				lineHeight = 1.1, // ems
				y = new_text.attr("y"),
				dy = parseFloat(text.attr("dy")),
				tspan = new_text
					.text(null)
					.append("tspan")
					.attr("x", -10)
					.attr("y", y)
					.attr("dy", dy + "em");

			while ((word = words.pop())) {
				line.push(word);
				tspan.text(line.join(" "));
				if (tspan.node().getComputedTextLength() > width) {
					line.pop();
					tspan.text(line.join(" "));
					line = [word];
					lineNumber++;
					tspan = new_text
						.append("tspan")
						.attr("x", -10)
						.attr("y", y)
						.attr("dy", lineNumber * lineHeight + dy + "em")
						.text(word);
				}
			}

			//move the text to the center of the bar
			new_text.attr("transform", "translate(0," + -lineNumber * lineHeight + ")");
		});
	}
	const drawChart = (windowWidth) => {
		// Set dimensions and margins for the graph

		// Sort data
		let dataSpliced = data;
		const margin = { top: 10, right: 10, bottom: 30, left: 100 };
		const width = windowWidth - margin.left - margin.right;
		const height = Math.max(windowWidth - margin.top - margin.bottom, dataSpliced.length * 50);
		// Clear existing content
		d3.select("#bar-chart" + id)
			.selectAll("*")
			.remove();
		// Append the svg object to a div or other container
		const svg = d3
			.select("#bar-chart" + id)
			.append("svg")
			.attr("width", width + margin.left + margin.right)
			.attr("height", height + margin.top + margin.bottom)
			.append("g")
			.attr("transform", "translate(" + margin.left + "," + margin.top + ")");
		const allPositive = dataSpliced.every((d) => d.value >= 0);

		// X axis: scale and draw
		// const x = d3
		// 	.scaleLinear()
		// 	.domain(
		// 		fixedXAxis
		// 			? xFixedValues
		// 			: allPositive
		// 			? [0, d3.max(dataSpliced, (d) => d.value)]
		// 			: [d3.min(dataSpliced, (d) => d.value), d3.max(dataSpliced, (d) => d.value)]
		// 	)
		// 	.range([0, width]);
		const x = d3.scaleLinear().domain([0, 1]).range([0, width]);

		svg
			.append("g")
			.attr("transform", "translate(0," + height + ")")
			.call(d3.axisBottom(x));

		// Add X axis label
		svg
			.append("text")
			.attr("text-anchor", "end")
			.attr("x", width)
			.attr("y", height + margin.bottom)
			.text(xAxisLabel);

		// Y axis: scale and draw
		const y = d3
			.scaleBand()
			.range([0, height])
			.domain(dataSpliced.map((d) => d.name))
			.padding(0.1);

		const yAxis = svg.append("g").call(d3.axisLeft(y));

		// Apply the wrapText function to the Y-axis labels
		yAxis.selectAll("text").call(wrapText, margin.left - 5);

		// Add Y axis label
		svg
			.append("text")
			.attr("text-anchor", "end")
			// .attr("transform", "rotate(-90)")
			.attr("y", margin.top)
			.attr("x", -margin.top)
			.text(yAxisLabel);

		// Bars
		svg
			.selectAll("rect")
			.data(dataSpliced)
			.join("rect")
			.attr("x", (d) => (d.value < 0 ? x(d.value) : x(0)))
			.attr("y", (d) => y(d.name))
			.attr("width", (d) => Math.abs(x(d.value) - x(0)))
			.attr("height", y.bandwidth())
			.attr("fill", (d) => (d.value < 0 ? "#ff0000" : "#69b3a2"));
		if (lineValue !== null) {
			// Convert the value to the corresponding y-coordinate
			const xPosition = x(lineValue); // Assuming 'y' is your y-axis scale function

			// Append a line to the chart
			svg
				.append("line")
				.style("stroke", "red") // Color of the line
				.style("stroke-width", 2) // Thickness of the line
				.style("stroke-dasharray", "5,5") // Dashed line
				.attr("x1", xPosition) // Starting x-coordinate of the line (at the y-axis)
				.attr("x2", xPosition) // Ending x-coordinate of the line (across the chart)
				.attr("y1", 0) // y-coordinate based on the value for both start and end points to make it horizontal
				.attr("y2", height);
		}

		const tooltip = d3.select("#bar-chart-tooltip" + id);

		// Mouseover event
		const mouseover = (event, d) => {
			tooltip.transition().duration(200).style("opacity", 0.9);
			tooltip
				.html(d.name + ": " + d.value)
				.style("left", event.pageX + 10 + "px") // Offset by 10px from mouse x
				.style("top", event.pageY - 10 + "px"); // Offset by 10px from mouse y
		};

		// Mouseout event
		const mouseout = (event, d) => {
			tooltip.transition().duration(500).style("opacity", 0);
		};
		// Add interactivity (optional)
		svg
			.selectAll("rect")
			.on("mouseover", function () {
				d3.select(this).attr("fill", "#b4e3b7");
			})
			.on("mouseout", function () {
				d3.select(this).attr("fill", "#69b3a2");
			})
			.on("mouseover", mouseover)
			.on("mouseout", mouseout);
		// Apply text wrapping to the Y-axis labels
		svg.selectAll(".y-axis text").call(wrapText, margin.left - 10);
	};

	onMount(() => {
		drawChart(windowWidth);

		return () => {
			d3.select("#bar-chart" + id)
				.selectAll("*")
				.remove();
		};
	});
</script>

<div class="flex w-full flex-col" {id}>
	<div class="w-full" bind:this={element}>
		<div id={"bar-chart" + id} class="h-[400px]" />
		<div id={"bar-chart-tooltip" + id} class="tooltip" style="opacity: 0;" />
	</div>
	<div class="w-full items-center text-center">
		<h2>{name}</h2>
	</div>
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
