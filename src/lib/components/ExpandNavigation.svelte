<script lang="ts">
	export let isCollapsed: boolean = false;
	export let classNames: string;
</script>

<button
	on:click
	class="{classNames} group absolute flex h-16 w-6 flex-col items-center justify-center -space-y-1 outline-none *:h-3.5 *:w-1 *:rounded-full *:bg-gray-100 *:transition-all *:hover:bg-gray-300 dark:*:hover:bg-gray-600 {!isCollapsed
		? 'dark:*:bg-gray-800'
		: 'dark:*:bg-gray-700'}"
>
	<div class={!isCollapsed ? "group-hover:rotate-[20deg]" : "group-hover:-rotate-[20deg]"} />
	<div class={!isCollapsed ? "group-hover:-rotate-[20deg]" : "group-hover:rotate-[20deg]"} />
</button>
