<script lang="ts">
	import { createEventDispatcher } from "svelte";

	import Modal from "$lib/components/Modal.svelte";
	import CarbonClose from "~icons/carbon/close";
	import CarbonTrashCan from "~icons/carbon/trash-can";
	import CarbonArrowUpRight from "~icons/carbon/arrow-up-right";

	import { enhance } from "$app/forms";
	import { base } from "$app/paths";

	import { useSettingsStore } from "$lib/stores/settings";
	import Switch from "$lib/components/Switch.svelte";
	import { PUBLIC_APP_DATA_SHARING } from "$env/static/public";

	let isConfirmingDeletion = false;

	const dispatch = createEventDispatcher<{ close: void }>();

	let settings = useSettingsStore();
</script>

<div class="flex w-full flex-col gap-5">
	<div class="flex items-start justify-between text-xl font-semibold text-gray-800">
		<h2>Application Settings</h2>
	</div>

	<div class="flex h-full flex-col gap-4 pt-4 max-sm:pt-0">
		{#if PUBLIC_APP_DATA_SHARING === "1"}
			<!-- svelte-ignore a11y-label-has-associated-control -->
			<label class="flex items-center">
				<Switch
					name="shareConversationsWithModelAuthors"
					bind:checked={$settings.shareConversationsWithModelAuthors}
				/>
				<div class="inline cursor-pointer select-none items-center gap-2 pl-2">
					Share conversations with model authors
				</div>
			</label>

			<p class="text-sm text-gray-500">
				Sharing your data will help improve the training data and make open models better over time.
			</p>
		{/if}
		<!-- svelte-ignore a11y-label-has-associated-control -->
		<label class="mt-6 flex items-center">
			<Switch name="hideEmojiOnSidebar" bind:checked={$settings.hideEmojiOnSidebar} />
			<div class="inline cursor-pointer select-none items-center gap-2 pl-2">
				Hide emoticons in conversation topics
			</div>
		</label>

		<div class="mt-12 flex flex-col gap-3">
			<a
				href="https://huggingface.co/spaces/huggingchat/chat-ui/discussions"
				target="_blank"
				rel="noreferrer"
				class="flex items-center underline decoration-gray-300 underline-offset-2 hover:decoration-gray-700"
				><CarbonArrowUpRight class="mr-1.5 shrink-0 text-sm " /> Share your feedback on HuggingChat</a
			>
			<button
				on:click|preventDefault={() => (isConfirmingDeletion = true)}
				type="submit"
				class="flex items-center underline decoration-gray-300 underline-offset-2 hover:decoration-gray-700"
				><CarbonTrashCan class="mr-2 inline text-sm text-red-500" />Delete all conversations</button
			>
		</div>
	</div>

	{#if isConfirmingDeletion}
		<Modal on:close={() => (isConfirmingDeletion = false)}>
			<form
				use:enhance={() => {
					dispatch("close");
				}}
				method="post"
				action="{base}/conversations?/delete"
				class="flex w-full flex-col gap-5 p-6"
			>
				<div class="flex items-start justify-between text-xl font-semibold text-gray-800">
					<h2>Are you sure?</h2>
					<button
						type="button"
						class="group"
						on:click|stopPropagation={() => (isConfirmingDeletion = false)}
					>
						<CarbonClose class="text-gray-900 group-hover:text-gray-500" />
					</button>
				</div>
				<p class="text-gray-800">
					This action will delete all your conversations. This cannot be undone.
				</p>
				<button
					type="submit"
					class="mt-2 rounded-full bg-red-700 px-5 py-2 text-lg font-semibold text-gray-100 ring-gray-400 ring-offset-1 transition-all focus-visible:outline-none focus-visible:ring hover:ring"
				>
					Confirm deletion
				</button>
			</form>
		</Modal>
	{/if}
</div>
