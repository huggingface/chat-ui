<script lang="ts">
	interface Props {
		classNames?: string;
	}

	let { classNames = "" }: Props = $props();
</script>

<svg
	class={classNames}
	xmlns="http://www.w3.org/2000/svg"
	aria-hidden="true"
	focusable="false"
	role="img"
	width="1em"
	height="1em"
	fill="currentColor"
	viewBox="0 0 32 32"
	><path
		fill-rule="evenodd"
		clip-rule="evenodd"
		d="M5.98 6.01h20.04v16.1H5.98V6.02Zm-2.1 0c0-1.16.94-2.1 2.1-2.1h20.04c1.16 0 2.1.94 2.1 2.1v16.1a2.1 2.1 0 0 1-2.1 2.11H5.98a2.1 2.1 0 0 1-2.1-2.1V6.02Zm5.7 1.65a2.1 2.1 0 0 0-2.1 2.1v2.61a1.05 1.05 0 0 0 2.1 0v-2.6h2.96a1.05 1.05 0 1 0 0-2.11H9.58ZM24.41 18.4a2.1 2.1 0 0 1-2.1 2.1h-2.95a1.05 1.05 0 1 1 0-2.1h2.95v-2.61a1.05 1.05 0 0 1 2.1 0v2.6ZM10.1 25.9a1.05 1.05 0 1 0 0 2.1H22.3a1.05 1.05 0 1 0 0-2.1H10.1Z"
	/>
</svg>
