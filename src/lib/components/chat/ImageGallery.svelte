<script lang="ts">
	export let onSelectImage: (image: Image) => void;

	type Image = {
		id: string;
		url: string;
	};
	export let images: Array<Image> = [];

	let selectedImage: Image | null = null;

	function selectImage(image: Image) {
		selectedImage = image;
		onSelectImage(image);
	}
</script>

<div
	class="image-gallery mb-6 rounded-lg border border-gray-200 px-2 py-2 text-sm shadow-sm dark:border-gray-600"
>
	{#each images as image}
		<button on:click={() => selectImage(image)}>
			<img
				src={image.url}
				alt={image.id}
				class:selected={selectedImage === image}
				height="200px"
				class="border-grey-300 m-4 rounded-lg border hover:border-red-400"
			/>
		</button>
	{/each}
</div>

<style>
	.image-gallery {
		display: flex;
		overflow-x: scroll;
		scroll-snap-type: x mandatory;
		scroll-behavior: smooth;
		-webkit-overflow-scrolling: touch;
	}

	img {
		scroll-snap-align: center;
		max-height: 100px;
		margin-right: 10px;
		cursor: pointer;
	}

	img.selected {
		border: 2px solid red;
	}
</style>
