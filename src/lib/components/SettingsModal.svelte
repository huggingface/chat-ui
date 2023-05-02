<script lang="ts">
	import { createEventDispatcher } from "svelte";

	import Modal from "$lib/components/Modal.svelte";
	import CarbonClose from "~icons/carbon/close";
	import Switch from "$lib/components/Switch.svelte";
	import type { Settings } from "$lib/types/Settings";
	import { updateSettings } from "$lib/updateSettings";

	export let settings: Pick<Settings, "shareConversationsWithModelAuthors">;

	const dispatch = createEventDispatcher<{ close: void }>();
</script>

<Modal>
	<div class="flex w-full flex-col gap-5 p-6">
		<div class="flex items-start justify-between text-xl font-semibold text-gray-800">
			<h2>Settings</h2>
			<button class="group" on:click={() => dispatch("close")}>
				<CarbonClose class="text-gray-900 group-hover:text-gray-500" />
			</button>
		</div>

		<label class="flex cursor-pointer select-none items-center gap-2 text-gray-500" for="switch">
			<Switch name="switch" bind:checked={settings.shareConversationsWithModelAuthors} />
			Share conversations with model authors
		</label>

		<p class="text-gray-800">
			Sharing your data will help improve the training data and make open models better over time.
		</p>
		<p class="text-gray-800">
			Changing this setting will apply to all your conversations, past and future.
		</p>
		<p class="text-gray-800">
			Read more about this model's authors,
			<a
				href="https://open-assistant.io/"
				target="_blank"
				rel="noreferrer"
				class="underline decoration-gray-300 hover:decoration-gray-700">Open Assistant</a
			>.
		</p>
		<button
			type="button"
			class="mt-2 rounded-full bg-black px-5 py-2 text-lg font-semibold text-gray-100 ring-gray-400 ring-offset-1 transition-colors hover:ring"
			on:click={() =>
				updateSettings({
					shareConversationsWithModelAuthors: settings.shareConversationsWithModelAuthors,
				}).then((res) => {
					if (res) {
						dispatch("close");
					}
				})}
		>
			Apply
		</button>
	</div>
</Modal>
