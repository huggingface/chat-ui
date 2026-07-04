<script lang="ts">
	interface Props {
		classNames?: string;
	}

	let { classNames = "" }: Props = $props();
</script>

<svg
	class="text-gray-500 {classNames}"
	xmlns="http://www.w3.org/2000/svg"
	role="img"
	width="1em"
	height="1em"
	viewBox="0 0 12 12"
	><path
		d="M6.481 1.26c0 1.55.67 2.58 1.5 3.24.86.68 1.9 1 2.58 1.07v.86a5.3 5.3 0 0 0-2.57 1.07 3.95 3.95 0 0 0-1.51 3.24h-.96c0-1.55-.67-2.58-1.5-3.24a5.3 5.3 0 0 0-2.58-1.07v-.86a5.3 5.3 0 0 0 2.57-1.07 3.95 3.95 0 0 0 1.51-3.24h.96Z"
		fill="#FF8D00"
	/></svg
>
