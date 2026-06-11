<script lang="ts">
	import Modal from "$lib/components/Modal.svelte";
	import { onMount } from "svelte";

	import CarbonClose from "~icons/carbon/close";
	import CarbonArrowUpRight from "~icons/carbon/arrow-up-right";

	interface Props {
		/** Must already be validated by the caller (parseExternalUrl): http(s) only */
		url: URL;
		onclose?: () => void;
	}

	let { url, onclose }: Props = $props();

	let openButtonEl: HTMLButtonElement | undefined = $state();

	function close() {
		onclose?.();
	}

	function confirmOpen() {
		window.open(url.href, "_blank", "noopener,noreferrer");
		close();
	}

	onMount(() => {
		setTimeout(() => {
			openButtonEl?.focus();
		}, 100);
	});
</script>

<Modal onclose={close} width="w-[90dvh] md:w-[480px]">
	<div class="flex w-full flex-col gap-5 p-6">
		<div class="flex items-start justify-between">
			<h2 class="text-xl font-semibold text-gray-800 dark:text-gray-200">Open external link?</h2>
			<button type="button" class="group outline-none" onclick={close} aria-label="Close">
				<CarbonClose
					class="size-5 text-gray-700 group-hover:text-gray-500 dark:text-gray-300 dark:group-hover:text-gray-400"
				/>
			</button>
		</div>

		<p class="text-sm text-gray-600 dark:text-gray-400">
			This link leads outside of the preview and will open in a new tab. Only continue if you trust
			the destination.
		</p>

		<p
			class="break-all rounded-xl border border-gray-200 bg-gray-50 px-3.5 py-2.5 font-mono text-xs text-gray-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400"
		>
			{url.protocol}//<span class="font-semibold text-gray-800 dark:text-gray-200">{url.host}</span
			>{url.href.slice(url.origin.length)}
		</p>

		<div class="flex items-center justify-end gap-2">
			<button
				type="button"
				class="inline-flex items-center rounded-xl border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-900 shadow outline-none hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-700 dark:text-gray-100 dark:hover:bg-gray-600"
				onclick={close}
			>
				Cancel
			</button>
			<button
				bind:this={openButtonEl}
				type="button"
				class="inline-flex items-center gap-1.5 rounded-xl border border-gray-900 bg-gray-900 px-3 py-1.5 text-sm font-semibold text-white hover:bg-black focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-2 dark:border-gray-100 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-white dark:focus:ring-offset-gray-800"
				onclick={confirmOpen}
			>
				Open link
				<CarbonArrowUpRight class="size-3.5" />
			</button>
		</div>
	</div>
</Modal>
