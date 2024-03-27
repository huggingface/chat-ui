<script lang="ts">
	export let label = "";
</script>

<div class="group/tooltip md:relative">
	<slot />
	<div
		class="invisible absolute z-10 w-64 whitespace-normal rounded-md bg-black p-2 text-center text-white group-hover/tooltip:visible group-active/tooltip:visible max-sm:left-1/2 max-sm:-translate-x-1/2"
	>
		{label}
	</div>
</div>
