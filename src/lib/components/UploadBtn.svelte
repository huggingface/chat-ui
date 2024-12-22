<script lang="ts">
	import CarbonUpload from "~icons/carbon/upload";

	export let classNames = "";
	export let files: File[];
	export let mimeTypes: string[];

	/**
	 * Due to a bug with Svelte, we cannot use bind:files with multiple
	 * So we use this workaround
	 **/
	const onFileChange = (e: Event) => {
		if (!e.target) return;
		const target = e.target as HTMLInputElement;
		files = [...files, ...(target.files ?? [])];
	};
</script>

<button
	class="btn relative h-8 rounded-lg border bg-white px-3 py-1 text-sm text-gray-500 shadow-sm hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600 {classNames}"
>
	<input
		class="absolute w-full cursor-pointer opacity-0"
		aria-label="Upload file"
		type="file"
		on:change={onFileChange}
		accept={mimeTypes.join(",")}
	/>
	<CarbonUpload class="mr-2 text-xxs" /> Upload file
</button>
