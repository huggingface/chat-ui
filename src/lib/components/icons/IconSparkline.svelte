<script lang="ts">
	interface Props {
		classNames?: string;
	}
	let { classNames = "" }: Props = $props();
</script>

<!-- A rising trace rather than Carbon's axes-and-grid chart: at 14px the axes
     turn to mud, and the one thing this has to read as is "metrics moving". -->
<svg
	class={classNames}
	viewBox="0 0 16 16"
	fill="none"
	stroke="currentColor"
	stroke-width="1.6"
	stroke-linecap="round"
	stroke-linejoin="round"
	aria-hidden="true"
>
	<path d="M1.5 11.5 5 7.5l2.5 2.5L14 3.5" />
	<path d="M10.5 3.5H14v3.5" />
</svg>
