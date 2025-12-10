<script lang="ts">
	import Modal from "$lib/components/Modal.svelte";
	import IconOmni from "$lib/components/icons/IconOmni.svelte";
	import { usePublicConfig } from "$lib/utils/PublicConfig.svelte";

	const publicConfig = usePublicConfig();

	interface Props {
		close: () => void;
	}

	let { close }: Props = $props();
</script>

<Modal closeOnBackdrop={false} onclose={close} width="!max-w-[420px] !m-4">
	<div
		class="flex w-full flex-col gap-8 bg-white bg-gradient-to-b to-transparent px-6 pb-7 dark:bg-black dark:from-white/10 dark:to-white/5"
	>
		<div
			class="relative -mx-6 grid h-48 select-none place-items-center bg-gradient-to-t from-black/5 dark:from-white/10"
		>
			<img
				class="size-full bg-black object-cover"
				src="{publicConfig.assetPath}/omni-welcome.gif"
				alt="Omni AI model router animation"
			/>
			<!-- <h2
				class="flex translate-y-1 items-center text-3xl font-semibold text-gray-900 dark:text-gray-100"
			>
				<Logo classNames="mr-2 size-12 dark:invert" />
				{publicConfig.PUBLIC_APP_NAME}
			</h2> -->
			<div
				class="absolute bottom-3 right-3 rounded-lg border border-blue-500/20 bg-blue-500/20 px-2 py-0.5 text-sm font-semibold text-blue-500"
			>
				Now with MCP!
			</div>
		</div>

		<div class="text-gray-700 dark:text-gray-200">
			<p class="text-[15px] leading-relaxed">
				Welcome to {publicConfig.PUBLIC_APP_NAME}, the chat app powered by open source AI models.
			</p>
			<p class="mt-3 text-[15px] leading-relaxed">
				<IconOmni classNames="-translate-y-px" /> Omni automatically picks the best AI model to give
				you optimal answers depending on your requests.
			</p>
			<p class="mt-3 text-[15px] leading-relaxed">
				You can also choose from any available open source models to chat with directly.
			</p>
		</div>

		<button
			class="k w-full rounded-xl bg-black px-5 py-2.5 text-base font-medium text-white hover:bg-gray-800 dark:bg-white dark:text-black dark:hover:bg-gray-200"
			onclick={close}
		>
			Start chatting
		</button>
	</div>
</Modal>
