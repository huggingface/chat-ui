<script lang="ts">
	export let classNames = "";
	export let webgpuSupported = true;
</script>

{#if webgpuSupported}
<svg
	class={classNames}
	xmlns="http://www.w3.org/2000/svg"
	aria-hidden="true"
	focusable="false"
	role="img"
	width="1em"
	height="1em"
	fill="currentColor"
	preserveAspectRatio="xMidYMid meet"
	viewBox="0 0 24 24"
>
	<path
		d="M12 14a3.5 3.5 0 0 0 3.5-3.5V5.5A3.5 3.5 0 0 0 12 2a3.5 3.5 0 0 0-3.5 3.5v5A3.5 3.5 0 0 0 12 14zm6.5-3.5a6.5 6.5 0 0 1-13 0h-2a8.5 8.5 0 0 0 17 0h-2zM11 18v4h2v-4h-2z"
	/>
</svg>
{/if}
