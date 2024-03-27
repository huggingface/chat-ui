<script lang="ts">
	export let label = "";
	export let align: "left" | "right" = "left";
</script>

<div class="group/tooltip relative">
	<slot />
	<div
		class="invisible absolute z-10 w-64 items-center whitespace-normal rounded-md bg-black p-2 text-center text-white group-hover/tooltip:visible group-active/tooltip:visible max-sm:top-5 md:top-5"
		class:max-sm:left-0={align === "left"}
		class:max-sm:right-0={align === "right"}
	>
		{label}
	</div>
</div>
