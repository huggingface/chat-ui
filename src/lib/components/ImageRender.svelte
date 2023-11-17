<script lang="ts">
	// import { afterUpdate } from "svelte";
	import BoundingBoxEditor from "./BoundingBoxEditor.svelte";
	let annotationState = false;
	export let json = {
		id: "1",
		url: "https://media.npr.org/assets/img/2021/08/11/gettyimages-1279899488_wide-f3860ceb0ef19643c335cb34df3fa1de166e2761-s1100-c50.jpg",
		imageAlt: "A picture of a cat",
		imageWidth: 1100,
		imageHeight: 618,
		annotations: [
			{
				label: "cat",
				boundingBox: [60, 150, 600, 500],
			},
		],
	};
	const handleClickEdit = async () => {
		console.log("clicked");
		annotationState = !annotationState;
	};
	const onMoveAnnotation = (position: { x: number; y: number }, annotationMoveLabel: string) => {
		console.log("onMoveAnnotation", position, annotationMoveLabel);
		json.annotations = json.annotations.map((annotation) => {
			if (annotation.label === annotationMoveLabel) {
				annotation.boundingBox[0] = position.x;
				annotation.boundingBox[1] = position.y;
			}
			return annotation;
		});
	};
	const onResizeAnnotation = (
		size: { width: number; height: number },
		annotationResizeLabel: string
	) => {
		console.log("onResizeAnnotation", size, annotationResizeLabel);
		json.annotations = json.annotations.map((annotation) => {
			if (annotation.label === annotationResizeLabel) {
				annotation.boundingBox[2] = size.width + annotation.boundingBox[0];
				annotation.boundingBox[3] = size.height + annotation.boundingBox[1];
			}
			return annotation;
		});
	};
	// afterAll(() => {
	// 	renderImage(codeString);
	// });
</script>

<div class="image">
	<img
		class="img"
		src={json.url ?? "https://via.placeholder.com/400x400"}
		alt={json.imageAlt ?? "A placeholder image"}
		width={json.imageWidth ?? 400}
		height={json.imageHeight ?? 400}
	/>
	<button
		class="btn-annotation-edit rounded-lg border border-gray-200 px-2 py-2 text-sm shadow-sm transition-all hover:border-gray-300 active:shadow-inner dark:border-gray-600 dark:hover:border-gray-400"
		on:click={handleClickEdit}
	>
		{annotationState ? "Done" : "Edit Annotation"}
	</button>
	{#if json.annotations}
		{#each json.annotations as annotation}
			{#if annotationState}
				<BoundingBoxEditor
					initialX={annotation.boundingBox[0]}
					initialY={annotation.boundingBox[1]}
					initialWidth={annotation.boundingBox[2] - annotation.boundingBox[0]}
					initialHeight={annotation.boundingBox[3] - annotation.boundingBox[1]}
					label={annotation.label}
					onMove={onMoveAnnotation}
					onResize={onResizeAnnotation}
				/>
			{:else}
				<div
					class="bounding-box"
					style={`top: ${annotation.boundingBox[0]}px; left: ${
						annotation.boundingBox[1]
					}px; width: ${annotation.boundingBox[2] - annotation.boundingBox[0]}px; height: ${
						annotation.boundingBox[3] - annotation.boundingBox[1]
					}px;`}
				/>
				<div
					class="bounding-box-label"
					style={`top: ${annotation.boundingBox[0]}px; left: ${annotation.boundingBox[1]}px;`}
				>
					{annotation.label}
				</div>
			{/if}
		{/each}
	{/if}
</div>

<style>
	.image {
		position: relative;
		/* width: 100%;
		height: 100%; */
	}
	.image img {
		/* width: 100%;
		height: 100%; */
		object-fit: cover;
	}
	.image .bounding-box {
		position: absolute;
		border: 2px solid red;
	}
	.image .bounding-box-label {
		position: absolute;
		background-color: red;
		color: white;
		padding: 0.5rem;
		border-radius: 0.5rem;
	}
	.image .btn-annotation-edit {
		position: relative;
		top: 10;
		right: 10;
	}
</style>
