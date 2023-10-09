<script lang="ts">
	import { createEventDispatcher } from "svelte";

	import Modal from "$lib/components/Modal.svelte";
	import CarbonClose from "~icons/carbon/close";
	import Switch from "$lib/components/Switch.svelte";
	import { enhance } from "$app/forms";
	import { base } from "$app/paths";
	import { PUBLIC_APP_DATA_SHARING } from "$env/static/public";
	import type { Model } from "$lib/types/Model";
	import type { LayoutData } from "../../routes/$types";

	export let settings: LayoutData["settings"];
	export let models: Array<Model>;

	let shareConversationsWithModelAuthors = settings.shareConversationsWithModelAuthors;
	let isConfirmingDeletion = false;

	const dispatch = createEventDispatcher<{ close: void }>();
</script>

<Modal on:close>
	<div class="flex w-full flex-col gap-5 p-6">
		<div class="flex items-start justify-between text-xl font-semibold text-gray-800">
			<h2>Settings</h2>
			<button type="button" class="group" on:click={() => dispatch("close")}>
				<CarbonClose class="text-gray-900 group-hover:text-gray-500" />
			</button>
		</div>
		<form
			class="flex flex-col gap-5"
			use:enhance={() => {
				dispatch("close");
			}}
			method="post"
			action="{base}/settings"
		>
			{#if PUBLIC_APP_DATA_SHARING}
				<label class="flex cursor-pointer select-none items-center gap-2 text-gray-500">
					{#each Object.entries(settings).filter(([k]) => !(k === "shareConversationsWithModelAuthors" || k === "customPrompts")) as [key, val]}
						<input type="hidden" name={key} value={val} />
					{/each}
					<input
						type="hidden"
						name="customPrompts"
						value={JSON.stringify(settings.customPrompts)}
					/>
					<Switch
						name="shareConversationsWithModelAuthors"
						bind:checked={shareConversationsWithModelAuthors}
					/>
					Share conversations with model authors
				</label>

				<p class="text-gray-800">
					Sharing your data will help improve the training data and make open models better over
					time.
				</p>
				<p class="text-gray-800">
					You can change this setting at any time, it applies to all your conversations.
				</p>
				<div>
					<p class="text-gray-800">Read more about model authors:</p>
					<ul class="list-inside list-disc">
						{#each models as model}
							<li class="list-item">
								<a
									href={model["websiteUrl"]}
									target="_blank"
									rel="noreferrer"
									class="underline decoration-gray-300 hover:decoration-gray-700">{model["name"]}</a
								>
							</li>
						{/each}
					</ul>
				</div>
			{/if}
			<form
				method="post"
				action="{base}/conversations?/delete"
				on:submit|preventDefault={() => (isConfirmingDeletion = true)}
			>
				<button type="submit" class="underline decoration-gray-300 hover:decoration-gray-700">
					Delete all conversations
				</button>
			</form>
			<button
				type="submit"
				class="mt-2 rounded-full bg-black px-5 py-2 text-lg font-semibold text-gray-100 ring-gray-400 ring-offset-1 transition-all focus-visible:outline-none focus-visible:ring hover:ring"
			>
				Apply
			</button>
		</form>

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
						<button type="button" class="group" on:click={() => (isConfirmingDeletion = false)}>
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
</Modal>
