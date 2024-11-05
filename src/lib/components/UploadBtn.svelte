<script lang="ts">
	import CarbonUpload from "~icons/carbon/upload";

	export let classNames = "";
	export let files: File[];
	let filelist: FileList;

	$: if (filelist) {
		files = Array.from(filelist);
	}
</script>

<button
	class="btn relative h-8 rounded-lg border bg-white px-3 py-1 text-sm text-gray-500 shadow-sm transition-all hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600 {classNames}"
>
	<input
		bind:files={filelist}
		class="absolute w-full cursor-pointer opacity-0"
		type="file"
		accept="image/*"
	/>
	<CarbonUpload class="mr-2 text-xs " /> Upload image
</button>
