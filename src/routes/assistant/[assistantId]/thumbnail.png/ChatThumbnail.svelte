<script lang="ts">
	import { base } from "$app/paths";
	import { PUBLIC_APP_ASSETS } from "$env/static/public";

	export let href: string = "";
	export let name: string;
	export let description: string = "";
	export let createdByName = "";
	export let avatarUrl: string | undefined;

	const imgUrl = `${href}${base}/${PUBLIC_APP_ASSETS}/icon.svg`;
</script>

<div class="flex h-full w-full flex-col items-center justify-center bg-gray-900 p-2">
	<div class="flex w-full flex-row items-center justify-center bg-gray-900 p-2 text-white">
		{#if avatarUrl}
			<img class="h-32 w-32 rounded-full" src={avatarUrl} alt="avatar" />
		{:else}
			<div
				class="flex h-32 w-32 items-center justify-center rounded-full bg-gray-300 text-4xl font-bold uppercase text-gray-500"
			>
				{name[0]}
			</div>
		{/if}
		<div class="ml-10 flex flex-col items-start">
			<h1 class=" text-2xl font-thin">
				<img class=" mr-2 h-8 w-8" src={imgUrl} alt="app logo" />
				Chat with
			</h1>
			<span class="-mt-5 max-w-[65vw] text-3xl font-black">
				{name}
			</span>
			<h3 class="mt-2 font-medium text-gray-400">
				Created by
				<span class="ml-1 underline">{createdByName}</span>
			</h3>
		</div>
	</div>
	<h2 class="max-w-[90vw] items-center text-center font-medium text-gray-400">
		{description.slice(0, 200)}
		{#if description.length > 200}...{/if}
		<!-- line clamping doesnt work with satori hence this character based approach -->
	</h2>
</div>
