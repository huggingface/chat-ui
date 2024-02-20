<script lang="ts">
	import type { PageData } from "./$types";

	import { PUBLIC_APP_ASSETS, PUBLIC_ORIGIN, PUBLIC_APP_NAME } from "$env/static/public";
	import { isHuggingChat } from "$lib/utils/isHuggingChat";

	import { base } from "$app/paths";
	import { page } from "$app/stores";

	import CarbonHelpFilled from "~icons/carbon/help-filled";

	export let data: PageData;
</script>

<svelte:head>
	{#if isHuggingChat}
		<title>HuggingChat - Models</title>
		<meta property="og:title" content="HuggingChat - Models" />
		<meta property="og:type" content="link" />
		<meta property="og:description" content="Browse HuggingChat available models" />
		<meta
			property="og:image"
			content="{PUBLIC_ORIGIN || $page.url.origin}{base}/{PUBLIC_APP_ASSETS}/models-thumbnail.png"
		/>
		<meta property="og:url" content={$page.url.href} />
	{/if}
</svelte:head>

<div class="scrollbar-custom mr-1 h-full overflow-y-auto py-12 md:py-24">
	<div class="pt-42 mx-auto flex flex-col px-5 xl:w-[60rem] 2xl:w-[64rem]">
		<div class="flex items-center">
			<h1 class="text-2xl font-bold">Models</h1>
			{#if isHuggingChat}
				<a
					href="https://huggingface.co/spaces/huggingchat/chat-ui/discussions/357"
					class="ml-auto dark:text-gray-400 dark:hover:text-gray-300"
					target="_blank"
				>
					<CarbonHelpFilled />
				</a>
			{/if}
		</div>
		<h3 class="text-gray-500">All models available on {PUBLIC_APP_NAME}</h3>
		<dl class="mt-8 grid grid-cols-1 gap-3 sm:gap-5 xl:grid-cols-2">
			{#each data.models.filter((el) => !el.unlisted) as model (model.id)}
				<a
					href="{base}/settings/{model.id}"
					class="relative flex flex-col gap-2 overflow-hidden rounded-xl border bg-gray-50/50 px-6 py-5 shadow hover:bg-gray-50 hover:shadow-inner dark:border-gray-800/70 dark:bg-gray-950/20 dark:hover:bg-gray-950/40"
				>
					<img
						class=" size-6 rounded border"
						src="https://aeiljuispo.cloudimg.io/v7/https://cdn-uploads.huggingface.co/production/uploads/62dac1c7a8ead43d20e3e17a/wrLf5yaGC6ng4XME70w6Z.png?w=200&h=200&f=face"
						alt=""
					/>
					<dt class="flex items-center gap-2 font-semibold">
						{model.displayName}
					</dt>
					<dd class="text-sm text-gray-500">{model.description}</dd>
				</a>
			{/each}
		</dl>
	</div>
</div>
