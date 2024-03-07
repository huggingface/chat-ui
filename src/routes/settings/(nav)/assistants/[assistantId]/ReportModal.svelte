<script lang="ts">
	import { applyAction, enhance } from "$app/forms";
	import { invalidateAll } from "$app/navigation";
	import Modal from "$lib/components/Modal.svelte";
	import { createEventDispatcher } from "svelte";

	const dispatch = createEventDispatcher<{ close: void }>();

	let reason = "";
</script>

<Modal on:close>
	<form
		method="POST"
		action="?/report"
		use:enhance={() => {
			return async ({ result }) => {
				await applyAction(result);
				dispatch("close");
				invalidateAll();
			};
		}}
		class="w-full min-w-64 p-4"
	>
		<span class="mb-1 text-sm font-semibold">Report an assistant</span>

		<p class="text-sm text-gray-500">
			Please provide a brief description of why you are reporting this assistant.
		</p>

		<textarea
			name="reportReason"
			class="mt-6 max-h-48 w-full resize-y rounded-lg border-2 border-gray-200 bg-gray-100 p-2 text-smd"
			placeholder="Reason(s) for the report"
			maxlength="128"
			bind:value={reason}
		/>

		<div class="flex w-full flex-row justify-between px-2 pt-4">
			<button
				type="button"
				class="text-sm text-gray-700 hover:underline"
				on:click={() => dispatch("close")}>Cancel</button
			>

			<button
				type="submit"
				class="rounded-full bg-black px-4 py-2 text-sm font-semibold text-white md:px-8"
				disabled={!reason}
				class:bg-gray-200={!reason}
				class:!text-gray-400={!reason}
			>
				Submit report
			</button>
		</div>
	</form>
</Modal>
