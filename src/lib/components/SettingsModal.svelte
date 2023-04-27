<script lang="ts">
	import { createEventDispatcher } from "svelte";

	import Modal from "$lib/components/Modal.svelte";
	import CarbonClose from "~icons/carbon/close";
	import type { Settings } from "$lib/types/Settings";
	import { error } from "$lib/stores/errors";
	import { base } from "$app/paths";

	export let settings: Pick<Settings, "shareConversationsWithModelAuthors">;

	const dispatch = createEventDispatcher<{ close: void }>();

	async function updateSettings() {
		try {
			const res = await fetch(`${base}/settings`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(settings),
			});
			if (!res.ok) {
				$error = "Error while updating settings, try again.";
				return;
			}
			dispatch("close");
		} catch (err) {
			console.error(err);
			$error = String(err);
		}
	}
</script>

<Modal>
	<div class="flex w-full flex-col gap-5 p-6">
		<div class="flex items-start justify-between text-xl font-semibold text-gray-800">
			<h2>Settings</h2>
			<button class="group" on:click={() => dispatch("close")}>
				<CarbonClose class="text-gray-900 group-hover:text-gray-500" />
			</button>
		</div>

		<label class="flex items-center gap-2 text-gray-900 sm:text-base cursor-pointer">
			<input
				type="checkbox"
				bind:checked={settings.shareConversationsWithModelAuthors}
				class="h-4 w-4 cursor-pointer"
			/>
			Share conversations with model authors
		</label>

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
			on:click={updateSettings}
		>
			Apply
		</button>
	</div>
</Modal>
