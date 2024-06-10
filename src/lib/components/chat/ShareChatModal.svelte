<script lang="ts">
	import Modal from "$lib/components/Modal.svelte";
	import { createEventDispatcher } from "svelte";

	const dispatch = createEventDispatcher<{ close: void; confirm: void }>();
</script>

<Modal on:close>
	<div class="w-full min-w-64 p-4">
		<span class="mb-1 text-sm font-semibold">Are you sure you want to share this conversation?</span
		>

		<p class="text-sm text-gray-500">
			Sharing this conversation will make it public. Anyone with the link can view it.
		</p>

		<div class="flex w-full flex-row justify-between px-2 pt-4">
			<button
				type="button"
				class="text-sm text-gray-700 hover:underline"
				on:click={() => dispatch("close")}>Cancel</button
			>

			<button
				type="button"
				class="rounded-full bg-black px-4 py-2 text-sm font-semibold text-white md:px-8"
				on:click={() => dispatch("confirm")}
			>
				Share Conversation
			</button>
		</div>
	</div>
</Modal>
