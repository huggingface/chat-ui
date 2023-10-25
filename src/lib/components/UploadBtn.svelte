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
	class="btn flex h-8 rounded-lg border bg-white px-3 py-1 text-gray-500 shadow-sm transition-all hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600 {classNames}"
>
	<CarbonUpload class="mr-2 text-xs " /> Upload image
</button>
<input
	bind:files={filelist}
	class="pin-r pin-t absolute block w-full cursor-pointer px-4 py-2 opacity-0"
	type="file"
	accept="image/*"
/>
