<script lang="ts">
	export let label = "";
	export let align: "left" | "right" = "left";
</script>

<div class="group relative inline-block">
	<slot />
	<span
		class="invisible absolute
		z-10 w-max max-w-md
		items-center overflow-clip rounded-md bg-black p-1
		text-center
		text-white
		group-hover:visible
		group-active:visible
		max-sm:top-5 max-sm:w-48 md:top-5"
		class:max-sm:left-0={align === "left"}
		class:max-sm:right-0={align === "right"}
	>
		{label}
	</span>
</div>
