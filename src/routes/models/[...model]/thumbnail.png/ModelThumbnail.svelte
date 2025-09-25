<script lang="ts">
	import logo from "../../../../../static/huggingchat/fulltext-logo.svg?raw";

	interface Props {
		name: string;
		isHuggingChat?: boolean;
	}

	let { name, isHuggingChat = false }: Props = $props();
</script>

<div class=" flex h-[648px] w-full flex-col items-center justify-center bg-black text-white">
	<h1 class="mb-8 text-5xl font-bold text-white">
		{name}
	</h1>

	{#if isHuggingChat}{/if}

	{#if isHuggingChat}
		<div class="flex items-center text-5xl text-white">
			<div class="mr-4 text-4xl">Try it now on</div>
			<!-- eslint-disable-next-line -->
			{@html logo}
		</div>
	{/if}
</div>
