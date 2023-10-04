<script lang="ts">
	import Modal from "./Modal.svelte";
	import CarbonClose from "~icons/carbon/close";

	export let preprompt: string;

	let isOpen = false;
</script>

<button
	type="button"
	class="mx-auto rounded-xl border bg-gray-50 px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
	on:click={() => (isOpen = !isOpen)}
	on:keypress={(e) => e.key === "Enter" && (isOpen = !isOpen)}
>
	Custom System Prompt
</button>

{#if isOpen}
	<Modal on:close={() => (isOpen = false)} width="w-full max-w-xl">
		<div class="flex w-full flex-col gap-5 p-4 ">
			<div class="flex items-center justify-between text-lg font-semibold text-gray-800">
				<h2 class="">System Prompt</h2>
				<button type="button" class="group" on:click={() => (isOpen = false)}>
					<CarbonClose class="mt-auto text-gray-900 group-hover:text-gray-500" />
				</button>
			</div>
			<textarea
				disabled
				value={preprompt}
				class="min-h-[120px] w-full resize-none rounded-lg border bg-gray-50 p-1 pt-2 text-gray-600"
			/>
		</div>
	</Modal>
{/if}
