<script lang="ts">
	import logo from "../../../../../static/huggingchat/logo.svg?raw";
	import { usePublicConfig } from "$lib/utils/PublicConfig.svelte";
	const publicConfig = usePublicConfig();

	interface Props {
		name: string;
		logoUrl: string | undefined;
	}

	let { name, logoUrl }: Props = $props();
</script>

<div class=" flex h-[648px] w-full flex-col items-center bg-white">
	<div class="flex flex-1 flex-col items-center justify-center">
		{#if logoUrl}
			<img class="h-48 w-48" src={logoUrl} alt="avatar" />
		{/if}
		<h1 class="m-0 text-5xl font-bold text-black">
			{name}
		</h1>
	</div>

	<div
		class="flex h-[200px] w-full flex-col items-center justify-center rounded-b-none bg-{publicConfig.PUBLIC_APP_COLOR}-500/10 pb-10 pt-10 text-4xl text-gray-500"
		style="border-radius: 100% 100% 0 0;"
	>
		Try it now
		{#if publicConfig.isHuggingChat}
			on
		{/if}

		{#if publicConfig.isHuggingChat}
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
