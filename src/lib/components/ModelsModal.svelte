<script lang="ts">
	import { createEventDispatcher } from "svelte";

	import Modal from "$lib/components/Modal.svelte";
	import { updateSettings } from "$lib/updateSettings";
	import CarbonClose from "~icons/carbon/close";
	import CarbonEarth from "~icons/carbon/earth";
	import CarbonArrowUpRight from "~icons/carbon/arrow-up-right";
	import CarbonCheckmark from "~icons/carbon/checkmark-filled";

	export let currentModel: { name: string; displayName: string };
	export let models: Array<{ name: string; displayName: string }>;

	let selectedModelName = currentModel.name;

	const dispatch = createEventDispatcher<{ close: void }>();

	const handleSubmit = () => {
		updateSettings({
			activeModelName: selectedModelName,
		}).then((res) => {
			if (res) {
				dispatch("close");
			}
		});
	};
</script>

<Modal width="max-w-lg">
	<form on:submit|preventDefault={handleSubmit} class="flex w-full flex-col gap-5 p-6">
		<div class="flex items-start justify-between text-xl font-semibold text-gray-800">
			<h2>Models</h2>
			<button class="group" on:click={() => dispatch("close")}>
				<CarbonClose class="text-gray-900 group-hover:text-gray-500" />
			</button>
		</div>

		<div class="space-y-4">
			{#each models as model}
				<div
					class="rounded-xl border border-gray-100 {model.name === selectedModelName
						? 'bg-gradient-to-r from-yellow-200/40 via-yellow-500/10'
						: ''}"
				>
					<label class="group flex cursor-pointer p-3" on:change aria-label={model.displayName}>
						<input
							type="radio"
							class="sr-only"
							name="models"
							value={model.name}
							bind:group={selectedModelName}
						/>
						<span>
							<span class="text-md block font-semibold leading-tight text-gray-800"
								>{model.displayName}</span
							>
							<span class="text-xs text-[#9FA8B5]">A good alternative to ChatGPT</span>
						</span>
						<CarbonCheckmark
							class="-mr-1 -mt-1 ml-auto text-xl {model.name === selectedModelName
								? 'text-yellow-400'
								: 'text-transparent group-hover:text-gray-200'}"
						/>
					</label>
					<div
						class="flex items-center gap-5 rounded-xl bg-gray-100 px-3 py-2 text-sm text-gray-800 dark:bg-gray-100 dark:text-gray-600"
					>
						<a
							href="https://huggingface.co/OpenAssistant/oasst-sft-4-pythia-12b-epoch-3.5"
							target="_blank"
							rel="noreferrer"
							class="flex items-center hover:underline"
							><CarbonArrowUpRight class="mr-1.5 shrink-0 text-xs text-gray-400" />
							Model
							<div class="max-sm:hidden">&nbsp;page</div></a
						>
						<a
							href="https://huggingface.co/datasets/OpenAssistant/oasst1"
							target="_blank"
							rel="noreferrer"
							class="flex items-center hover:underline"
							><CarbonArrowUpRight class="mr-1.5 shrink-0 text-xs text-gray-400" />
							Dataset
							<div class="max-sm:hidden">&nbsp;page</div></a
						>
						<a
							href="https://open-assistant.io/"
							target="_blank"
							class="ml-auto flex items-center hover:underline"
							rel="noreferrer"
							><CarbonEarth class="mr-1.5 shrink-0 text-xs text-gray-400" />
							Open Assistant Website</a
						>
					</div>
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
