<script lang="ts">
	import { page } from "$app/stores";
	import Switch from "$lib/components/Switch.svelte";
	import type { BackendModel } from "$lib/server/models";
	import { useSettingsStore } from "$lib/stores/settings";

	const settings = useSettingsStore();

	$: if (!$settings.customPrompts[$page.params.model]) {
		$settings.customPrompts = {
			...$settings.customPrompts,
			[$page.params.model]:
				$page.data.models.find((el: BackendModel) => el.id === $page.params.model)?.preprompt || "",
		};
	}

	$: hasCustomPreprompt =
		$settings.customPrompts[$page.params.model] !==
		$page.data.models.find((el: BackendModel) => el.id === $page.params.model)?.preprompt;

	$: isActive = $settings.activeModel === $page.params.model;
</script>

<div class="flex w-full flex-col gap-5 p-6">
	<div>
		<h2 class="inline text-xl font-semibold text-gray-800">
			{$page.params.model}
		</h2>
		<button
			class="m-2 inline rounded-lg p-2"
			class:text-gray-500={isActive}
			class:bg-gray-200={!isActive}
			class:bg-gray-100={isActive}
			disabled={isActive}
			name="Activate model"
			on:click|stopPropagation={() => {
				$settings.activeModel = $page.params.model;
			}}>{isActive ? "Active" : "Activate"}</button
		>
	</div>
	<div class="flex w-full flex-col gap-2">
		<div class="flex w-full flex-row content-between">
			<h3 class="text-xl font-bold">System Prompt</h3>
			{#if hasCustomPreprompt}
				<button
					class="ml-auto underline decoration-gray-300 hover:decoration-gray-700"
					on:click|stopPropagation={() => ($settings.customPrompts[$page.params.model] = "")}
				>
					Reset
				</button>
			{/if}
		</div>
		<textarea
			class="h-32 w-full resize-none rounded-md border-2 border-gray-300 p-2"
			bind:value={$settings.customPrompts[$page.params.model]}
		/>
	</div>
</div>
