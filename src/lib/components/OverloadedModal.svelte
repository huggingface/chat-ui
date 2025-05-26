<script lang="ts">
	import { goto } from "$app/navigation";
	import { base } from "$app/paths";
	import { page } from "$app/state";
	import IconDazzled from "./icons/IconDazzled.svelte";
	import Modal from "./Modal.svelte";

	let { onClose }: { onClose: () => void } = $props();
</script>

<Modal on:close={onClose} width="!max-w-[400px] !m-4">
	<div
		class="from-primary-500/40 via-primary-500/10 to-primary-500/0 flex w-full flex-col items-center gap-3 bg-gradient-to-b px-5 pb-4 pt-9 text-center sm:px-6"
	>
		<div class="flex flex-wrap items-center gap-2">
			<IconDazzled classNames="text-3xl mx-auto" />
			<h2 class="flex flex-wrap items-center text-lg font-semibold text-gray-800">
				This model is currently overloaded.
			</h2>
		</div>

		<p class="text-sm text-gray-500">
			Please try again later or consider using a different model. We currently have {page.data
				.models.length} models available.
		</p>

		<div class="flex w-full flex-col items-center gap-4 pt-4">
			<button
				onclick={() => (onClose(), goto(`${base}/models`))}
				class="flex w-full flex-wrap items-center justify-center whitespace-nowrap rounded-full border-2 border-black bg-black px-5 py-2 text-lg font-semibold text-gray-100 transition-colors hover:bg-gray-900"
			>
				See all available models
			</button>
			<button
				onclick={onClose}
				class="flex w-fit flex-wrap items-center justify-center whitespace-nowrap px-2 py-1 text-gray-600 transition-colors hover:text-gray-900"
			>
				Close
			</button>
		</div>
	</div>
</Modal>
