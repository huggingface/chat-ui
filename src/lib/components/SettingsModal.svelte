<script lang="ts">
	import { createEventDispatcher } from "svelte";

	import Modal from "$lib/components/Modal.svelte";
	import CarbonClose from "~icons/carbon/close";

	const dispatch = createEventDispatcher<{ close: void }>();
</script>

<Modal>
	<div class="flex w-full flex-col gap-5 p-6">
		<div class="flex items-start justify-between text-xl font-semibold text-gray-800">
			<h2>Settings</h2>
			<button class="group" on:click={() => dispatch("close")}
				><CarbonClose class="text-gray-900 group-hover:text-gray-500" /></button
			>
		</div>

		<div class="flex items-center gap-2 text-gray-900 sm:text-base">
			<input type="checkbox" id="scales" name="scales" checked class="h-4 w-4" />
			<label for="scales">Share conversations with model authors</label>
		</div>

		<p class="text-gray-800">
			Sharing your data will help improve the training data and make open models better over time.
		</p>
		<p class=" text-gray-500">
			Read more about Open Assistant
			<a href="/" target="_blank" class="underline decoration-gray-300 hover:decoration-gray-700"
				>here</a
			>.
		</p>
		<button
			type="button"
			class="mt-2 rounded-full bg-black px-5 py-2 text-lg font-semibold text-gray-100 ring-gray-400 ring-offset-1 transition-colors hover:ring"
		>
			Apply
		</button>
	</div>
</Modal>
