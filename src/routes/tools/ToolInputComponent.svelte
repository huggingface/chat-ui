<script lang="ts">
	interface Props {
		type: string;
		value: string | boolean | number;
		disabled?: boolean;
	}

	let { type, value = $bindable(), disabled = false }: Props = $props();

	let innerValue: string | boolean | number = $state(
		(() => {
			if (type === "bool") {
				return Boolean(value) || false;
			} else if (type === "int" || type === "float") {
				return Number(value) || 0;
			} else {
				return value || "";
			}
		})()
	);
	let previousValue: string | boolean | number = $state("");

	$effect(() => {
		previousValue = innerValue;
	});

	$effect(() => {
		value = typeof innerValue === "string" ? innerValue : innerValue.toString();
	});
</script>

{#if type === "str" && typeof innerValue === "string"}
	<input
		type="text"
		class="w-full rounded-lg border-2 border-gray-200 bg-gray-100 p-2"
		bind:value={innerValue}
		{disabled}
	/>
{:else if type === "int" && typeof innerValue === "number"}
	<input
		type="number"
		step="1"
		class="w-full rounded-lg border-2 border-gray-200 bg-gray-100 p-2"
		{disabled}
		oninput={(e) => {
			const value = e.currentTarget.value;
			if (value === "" || isNaN(parseInt(value))) {
				innerValue = previousValue;
				e.currentTarget.value = previousValue.toString();
				return;
			} else {
				innerValue = parseFloat(value);
				previousValue = innerValue;
			}
		}}
		value={innerValue}
	/>
{:else if type === "float" && typeof innerValue === "number"}
	<input
		type="number"
		step="0.001"
		class="w-full rounded-lg border-2 border-gray-200 bg-gray-100 p-2"
		{disabled}
		oninput={(e) => {
			const value = e.currentTarget.value;
			if (value === "" || isNaN(parseFloat(value))) {
				innerValue = previousValue;
				e.currentTarget.value = previousValue.toString();
				return;
			} else {
				innerValue = parseFloat(value);
				previousValue = innerValue;
			}
		}}
		value={innerValue}
	/>
{:else if type === "bool" && typeof innerValue === "boolean"}
	<input
		type="checkbox"
		class="peer my-auto mr-4 size-6 rounded-lg border-2 border-gray-200 bg-gray-100 p-1"
		bind:checked={innerValue}
	/>
	<!-- Literal['bigvgan_24khz_100band', 'bigvgan_base_24khz_100band', 'bigvgan_22khz_80band', 'bigvgan_base_22khz_80band', 'bigvgan_v2_22khz_80band_256x', 'bigvgan_v2_22khz_80band_fmax8k_256x', 'bigvgan_v2_24khz_100band_256x', 'bigvgan_v2_44khz_128band_256x', 'bigvgan_v2_44khz_128band_512x'] -->
{:else if type.startsWith("Literal[") && typeof innerValue === "string"}
	{@const options = type
		.slice(8, -1)
		.split(",")
		.map((option) => option.trim().replaceAll("'", ""))}
	<select
		class="w-full rounded-lg border-2 border-gray-200 bg-gray-100 p-2"
		bind:value={innerValue}
		{disabled}
	>
		{#each options as option}
			<option value={option}>{option}</option>
		{/each}
	</select>
{:else}
	<span class="font-mono text-red-800">{innerValue}-{typeof innerValue}</span>
{/if}
