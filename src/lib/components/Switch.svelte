<script lang="ts">
	export let checked: boolean;
	export let name: string;
</script>

<div
	class="relative inline-flex h-5 w-9 items-center rounded-full p-1 shadow-inner transition-all {checked
		? 'bg-black'
		: 'bg-gray-300 hover:bg-gray-400'}"
>
	<input
		bind:checked
		type="checkbox"
		{name}
		id={name}
		class="peer absolute inset-0 cursor-pointer opacity-0"
	/>
	<div
		class="h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-all peer-checked:translate-x-3.5"
	/>
</div>
