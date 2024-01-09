<script lang="ts">
	import { base } from "$app/paths";
	import { PUBLIC_APP_ASSETS } from "$env/static/public";

	export let href: string = "";
	export let name: string;
	export let description: string = "";
	export let avatarUrl: string | undefined;

	const imgUrl = `${href}${base}/${PUBLIC_APP_ASSETS}/icon.svg`;
</script>

<div class="flex h-full w-full flex-col items-center bg-gray-900 p-2 pt-12 text-white">
	<img class="absolute right-6 top-6 h-12 w-12" src={imgUrl} alt="app logo" />
	{#if avatarUrl}
		<img class="h-24 w-24 rounded-full object-cover" src={avatarUrl} alt="avatar" />
	{:else}
		<div
			class="flex h-24 w-24 items-center justify-center rounded-full bg-gray-300 font-bold uppercase text-gray-500"
		>
			{name[0]}
		</div>
	{/if}
	<h1 class="mt-10 text-3xl font-black">
		{name}
	</h1>
	<h2 class="-mt-5 line-clamp-2 w-[90vw] truncate text-center font-medium text-gray-300">
		{description.slice(0, 200)}
		{#if description.length > 200}...{/if}
	</h2>
</div>
