<script>
	import IconImage from "~icons/carbon/image";
	export let sentence = "";
	export let image_required = false;
	let segments = [];
	let values = {};
	export let onclick = (msg) => {
		console.log(msg);
	};

	// Function to extract segments and placeholders, and initialize values
	function extractSegments(sentence) {
		const regex = /\{([^}]+)\}/g;
		let match;
		segments = [];
		values = {};

		let lastIndex = 0;
		while ((match = regex.exec(sentence)) !== null) {
			if (match.index > lastIndex) {
				segments.push({ type: "text", value: sentence.slice(lastIndex, match.index) });
			}
			segments.push({ type: "placeholder", value: match[1] });
			values[match[1]] = "";
			lastIndex = regex.lastIndex;
		}
		if (lastIndex < sentence.length) {
			segments.push({ type: "text", value: sentence.slice(lastIndex) });
		}
	}

	// Initialize segments on component mount and whenever the sentence changes
	$: extractSegments(sentence);

	// Function to replace placeholders with current values
	$: updatedSentence = sentence.replace(/\{([^}]+)\}/g, (_, p1) => values[p1]);
</script>

<div
	class="w-full px-3 py-3 hover:bg-gray-100 dark:hover:bg-gray-600"
	on:click={(msg) => {
		onclick(updatedSentence);
	}}
>
	{#if image_required}
		<IconImage class="inline-block h-6 w-6 text-gray-500 dark:text-gray-300" />
	{/if}
	{#if segments.length === 1 && segments[0].type === "text"}
		<span>{sentence}</span>
	{:else}
		{#each segments as segment}
			{#if segment.type === "text"}
				<span>{segment.value}</span>
			{:else if segment.type === "placeholder"}
				<input
					type="text"
					bind:value={values[segment.value]}
					placeholder={segment.value}
					class="input-box inline-block w-full px-3 py-3 hover:bg-gray-100 dark:hover:bg-gray-600"
				/>
			{/if}
		{/each}
	{/if}
</div>

<style>
	.container {
		overflow-y: auto;
		max-height: 80vh; /* Adjust this value as needed */
	}
	.input-box {
		width: auto;
		padding: 0.5rem;
		display: inline-block;
	}
	.sentence {
		margin-bottom: 2rem;
	}
	.sentence span {
		font-weight: bold;
		color: #2c3e50;
	}
</style>
