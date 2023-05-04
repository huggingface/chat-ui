<script lang="ts">
	export let checked: boolean;
	export let name: string;
</script>

<input bind:checked type="checkbox" {name} class="peer pointer-events-none absolute opacity-0" />
<div
	class="relative inline-flex h-5 w-9 items-center rounded-full bg-gray-300 p-1 shadow-inner transition-all peer-checked:bg-black hover:bg-gray-400  peer-checked:[&>div]:translate-x-3.5"
>
	<div class="h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-all" />
</div>
