<script lang="ts">
	export let name: string;
	export let description: string = "";
	export let avatarUrl: string | undefined;
</script>

<div
	class="flex h-full w-full flex-col items-center gap-1 bg-gray-900 bg-gradient-to-t from-gray-950 to-gray-900 p-4 text-white"
>
	{#if avatarUrl}
		<img class="h-24 w-24 rounded-full object-cover" src={avatarUrl} alt="avatar" />
	{:else}
		<div
			class="flex h-24 w-24 items-center justify-center rounded-full bg-gray-300 font-bold text-gray-500"
		>
			{name[0].toLocaleUpperCase()}
		</div>
	{/if}
	<h1 class="pt-4 text-4xl font-bold">
		{name}
	</h1>
	<h2 class="text-gray-300">{description}</h2>
</div>
