<script lang="ts">
	import { createEventDispatcher } from "svelte";

	import Modal from "$lib/components/Modal.svelte";
	import CarbonClose from "~icons/carbon/close";
	import CarbonCheckmark from "~icons/carbon/checkmark-filled";
	import ModelCardMetadata from "./ModelCardMetadata.svelte";
	import type { Model } from "$lib/types/Model";
	import type { LayoutData } from "../../routes/$types";
	import { enhance } from "$app/forms";
	import { base } from "$app/paths";

	export let settings: LayoutData["settings"];
	export let models: Array<Model>;

	let selectedModelId = settings.activeModel;

	const dispatch = createEventDispatcher<{ close: void }>();
</script>

<Modal width="max-w-lg" on:close>
	<form
		action="{base}/settings"
		method="post"
		use:enhance={() => {
			dispatch("close");
		}}
		class="flex w-full flex-col gap-5 p-6"
	>
		{#each Object.entries(settings).filter(([k]) => k !== "activeModel") as [key, val]}
			<input type="hidden" name={key} value={val} />
		{/each}
		<div class="flex items-start justify-between text-xl font-semibold text-gray-800">
			<h2>Models</h2>
			<button type="button" class="group" on:click={() => dispatch("close")}>
				<CarbonClose class="text-gray-900 group-hover:text-gray-500" />
			</button>
		</div>

		<div class="space-y-4">
			{#each models as model}
				<div
					class="rounded-xl border border-gray-100 {model.id === selectedModelId
						? 'bg-gradient-to-r from-primary-200/40 via-primary-500/10'
						: ''}"
				>
					<label class="group flex cursor-pointer p-3" on:change aria-label={model.displayName}>
						<input
							type="radio"
							class="sr-only"
							name="activeModel"
							value={model.id}
							bind:group={selectedModelId}
						/>
						<span>
							<span class="text-md block font-semibold leading-tight text-gray-800"
								>{model.displayName}</span
							>
							{#if model.description}
								<span class="text-xs text-[#9FA8B5]">{model.description}</span>
							{/if}
						</span>
						<CarbonCheckmark
							class="-mr-1 -mt-1 ml-auto shrink-0 text-xl {model.id === selectedModelId
								? 'text-primary-400'
								: 'text-transparent group-hover:text-gray-200'}"
						/>
					</label>
					<ModelCardMetadata {model} />
				</div>
			{/each}
		</div>
		<button
			type="submit"
			class="mt-2 rounded-full bg-black px-5 py-2 text-lg font-semibold text-gray-100 ring-gray-400 ring-offset-1 transition-colors hover:ring"
		>
			Apply
		</button>
	</form>
</Modal>
