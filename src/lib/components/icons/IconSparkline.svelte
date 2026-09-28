<script lang="ts">
	interface Props {
		classNames?: string;
	}
	let { classNames = "" }: Props = $props();
</script>

<svg
	class={classNames}
	viewBox="0 0 16 16"
	fill="none"
	stroke="currentColor"
	stroke-width="1.8"
	stroke-linecap="round"
	stroke-linejoin="round"
	aria-hidden="true"
>
	<path d="M2 11l4-4 3 3 5-5M10 5h4v4" />
</svg>
