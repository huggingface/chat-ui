<script lang="ts">
	import logo from "../../../../../static/huggingchat/fulltext-logo.svg?raw";

	interface Props {
		name: string;
		isHuggingChat?: boolean;
		backgroundImage?: string;
	}

	let { name, isHuggingChat = false }: Props = $props();
</script>

<!-- This is rendered to an image by satori, which honors inline styles but not the
	Tailwind classes, so the centering has to be inline (and the <h1> below must not be
	w-full, or it stretches and the name sticks to the left edge). The classes are kept
	so the markup still reads correctly. -->
<div
	class=" flex h-[648px] w-full flex-col items-center justify-center bg-black px-16 text-center text-white"
	style="background-image: url(https://cdn-uploads.huggingface.co/production/uploads/5f17f0a0925b9863e28ad517/L4XVRJ7MsfFDD7ROx_geO.png); display: flex; flex-direction: column; align-items: center; justify-content: center;"
>
	<h1 class="mb-8 text-7xl font-bold text-white">
		{name.split("/")[1]}
	</h1>

	{#if isHuggingChat}
		<div class="flex items-center text-5xl text-white">
			<div class="mr-4 text-4xl">Chat with it on</div>
			<!-- eslint-disable-next-line -->
			{@html logo}
		</div>
	{/if}
</div>
