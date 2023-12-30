<script lang="ts">
	export let name: string;
	export let description: string = "";
	export let avatarUrl: string | undefined;
</script>

<div class="flex h-full w-full flex-col items-center bg-gray-900 p-4 pt-12 text-white">
	{#if avatarUrl}
		<img class="h-24 w-24 rounded-full" src={avatarUrl} alt="avatar" />
	{:else}
		<div
			class="flex h-24 w-24 items-center justify-center rounded-full bg-gray-300 font-bold text-gray-500"
		>
			{name[0].toLocaleUpperCase()}
		</div>
	{/if}
	<h1 class="pt-2 text-3xl font-black">
		{name}
	</h1>
	<h2 class="font-medium text-gray-300">{description}</h2>
</div>
