<script>
	// Define the base URL and the json_data object with images and names
	import { base } from "$app/paths";
	export let json_data = {
		images: ["65d4204d-9c9c-4dad-b542-d021595d29dc", "caad6c1b-1b11-48c6-86d6-a5dcde8aa1fb"],
		names: ["passenger plane predictor", "fighter jet predictor"],
	};
</script>

<div class="grid grid-cols-{json_data['images'].length} gap-4">
	{#each json_data.images as image, index}
		<div class="flex flex-col items-center justify-center text-center">
			<img
				src={`${base}/images/${image}`}
				alt={json_data.names[index]}
				class="mb-2 h-auto max-w-full"
			/>
			<h5 class="text-lg">{json_data.names[index]}</h5>
		</div>
	{/each}
</div>
