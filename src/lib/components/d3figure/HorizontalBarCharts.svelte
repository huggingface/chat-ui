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
	export let xAxisLabel = "Reasons";
	export let yAxisLabel = "Attributes";
	export let title = "Bar Chart";

	let id = "-" + uuid();
	let windowWidth = 0;
	let resizeObserver = null;
	let element;
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
	function sortData(data) {
		return data.sort((a, b) => d3.descending(a.value, b.value));
	}
	const drawChart = (windowWidth) => {
		// Set dimensions and margins for the graph

		const margin = { top: 10, right: 10, bottom: 30, left: 150 };
		const width = windowWidth - margin.left - margin.right;
		const height = Math.max((windowWidth * 3) / 4 - margin.top - margin.bottom, data.length * 50);
		// Clear existing content
		d3.select("#bar-chart" + id)
			.selectAll("*")
			.remove();
		// Sort data
		data = sortData(data).slice(0, Math.min(3, data.length));
		// Append the svg object to a div or other container
		const svg = d3
			.select("#bar-chart" + id)
			.append("svg")
			.attr("width", width + margin.left + margin.right)
			.attr("height", height + margin.top + margin.bottom)
			.append("g")
			.attr("transform", "translate(" + margin.left + "," + margin.top + ")");

		// X axis: scale and draw
		// const x = d3
		// 	.scaleLinear()
		// 	.domain([0, d3.max(data, (d) => d.value)])
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
			.attr("y", height + margin.bottom - 1)
			.text(xAxisLabel);

		// Y axis: scale and draw
		const y = d3
			.scaleBand()
			.range([0, height])
			.domain(data.map((d) => d.name))
			.padding(0.1);

		const yAxis = svg.append("g").call(d3.axisLeft(y));

		// Apply the wrapText function to the Y-axis labels
		yAxis.selectAll("text").call(wrapText, margin.left - 5);

		// Add Y axis label
		svg
			.append("text")
			.attr("text-anchor", "end")
			// .attr("transform", "rotate(-90)")
			.attr("y", -margin.left + 20)
			.attr("x", -margin.top)
			.text(yAxisLabel);

		// Bars
		svg
			.selectAll("rect")
			.data(data)
			.join("rect")
			.attr("x", x(0))
			.attr("y", (d) => y(d.name))
			.attr("width", (d) => x(d.value))
			.attr("height", y.bandwidth())
			.attr("fill", "#69b3a2");

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
		resizeObserver = new ResizeObserver((entries) => {
			for (let entry of entries) {
				windowWidth = entry.contentRect.width;
			}
		});

		resizeObserver.observe(element);

		return () => {
			resizeObserver.disconnect();
		};
	});

	$: if (windowWidth > 0) {
		drawChart(windowWidth);
	}
</script>

<div class="w-full" bind:this={element}>
	<div id={"bar-chart" + id} />
	<div id={"bar-chart-tooltip" + id} class="tooltip" style="opacity: 0;" />
	<div class="flex w-full items-center justify-center">
		<h4>{title}</h4>
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
