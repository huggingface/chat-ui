<script lang="ts">
	export let name: string;
	export let description: string = "";
	export let createdByName: string | undefined;
	export let avatar: string | undefined;

	import logo from "../../../../../static/huggingchat/logo.svg?raw";
</script>

<div class="flex h-full w-full flex-col items-center justify-center bg-black p-2">
	<div class="flex w-full max-w-[540px] items-start justify-center text-white">
		{#if avatar}
			<img class="h-64 w-64 rounded-full" style="object-fit: cover;" src={avatar} alt="avatar" />
		{/if}
		<div class="ml-10 flex flex-col items-start">
			<p class="mb-2 mt-0 text-3xl font-normal text-gray-400">
				<span class="mr-1.5 h-8 w-8">
					<!-- eslint-disable-next-line -->
					{@html logo}
				</span>
				AI assistant
			</p>
			<h1 class="m-0 {name.length < 38 ? 'text-5xl' : 'text-4xl'} font-black">
				{name}
			</h1>
			<p class="mb-8 text-2xl">
				{description.slice(0, 160)}
				{#if description.length > 160}...{/if}
			</p>
			<div class="rounded-full bg-[#FFA800] px-8 py-3 text-3xl font-semibold text-black">
				Start chatting
			</div>
		</div>
	</div>
	{#if createdByName}
		<p class="absolute bottom-4 right-8 text-2xl text-gray-400">
			An AI assistant created by {createdByName}
		</p>
	{/if}
</div>
