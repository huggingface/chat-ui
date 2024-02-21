<script lang="ts">
	import { PUBLIC_APP_COLOR } from "$env/static/public";
	import { isHuggingChat } from "$lib/utils/isHuggingChat";

	export let name: string;
	export let description: string = "";
	export let logoUrl: string | undefined;

	import logo from "../../../../../static/huggingchat/logo.svg?raw";
</script>

<div class=" flex h-[648px] w-full flex-col items-center bg-white p-12 pb-0">
	{#if logoUrl}
		<img
			class="mb-8 h-48 w-48 border-black"
			style="object-fit: cover;"
			src={logoUrl}
			alt="avatar"
		/>
	{/if}
	<h1 class="m-0 text-5xl font-bold text-black">
		{name}
	</h1>
	<p class="mb-4 flex-grow text-2xl">
		{description.slice(0, 160)}
		{#if description.length > 160}...{/if}
	</p>

	<div
		class="flex h-[200px] w-[1200px] flex-col items-center self-center rounded-b-none pb-10 bg-{PUBLIC_APP_COLOR}-100 pt-10 text-4xl text-{PUBLIC_APP_COLOR}-800"
		style="border-radius: 100% 100% 0 0 / 30%;"
	>
		Try it now
		{#if isHuggingChat}
			on
		{/if}

		{#if isHuggingChat}
			<div class="flex flex-row pt-3 text-5xl font-bold text-black">
				<div class="mr-5 flex items-center justify-center" id="logo">
					<!-- eslint-disable-next-line -->
					{@html logo}
				</div>
				<span>HuggingChat</span>
			</div>
		{/if}
	</div>
</div>
