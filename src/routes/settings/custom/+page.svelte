<script lang="ts">
	import { useSettingsStore } from "$lib/stores/settings";

	const settings = useSettingsStore();

	$: if ($settings.customInstruction === undefined) {
		$settings.customInstruction = "";
	}

	$: hasCustomInstruction = $settings.customInstruction !== "";
</script>

<div class="flex flex-col items-start">
	<div class="flex w-full flex-col gap-2">
		<div class="flex w-full flex-row content-between">
			<h3 class="mb-1.5 text-lg font-semibold text-gray-800">Custom Instructions</h3>
			{#if hasCustomInstruction}
				<button
					class="ml-auto underline decoration-gray-300 hover:decoration-gray-700"
					on:click|stopPropagation={() => ($settings.customInstruction = "")}
				>
					Reset
				</button>
			{/if}
		</div>
		<textarea
			rows="10"
			class="w-full resize-none rounded-md border-2 bg-gray-100 p-2"
			bind:value={$settings.customInstruction}
		/>
	</div>
</div>
