<script lang="ts">
	interface Props {
		value: unknown;
		clamp?: boolean;
	}

	let { value, clamp = false }: Props = $props();

	const OPEN_LINES = 12;

	let pretty = $derived(JSON.stringify(value, null, 2) ?? String(value));
	let lines = $derived(pretty.split("\n").length);
	let summary = $derived.by(() => {
		if (Array.isArray(value)) return `${value.length} item${value.length === 1 ? "" : "s"}`;
		if (value !== null && typeof value === "object") {
			const keys = Object.keys(value);
			return `${keys.length} key${keys.length === 1 ? "" : "s"}: ${keys.slice(0, 4).join(", ")}${keys.length > 4 ? ", …" : ""}`;
		}
		return pretty;
	});
</script>

{#if clamp || lines > OPEN_LINES}
	<details class="group min-w-0" open={!clamp && lines <= OPEN_LINES}>
		<summary
			class="cursor-pointer truncate font-mono text-xs text-gray-500 select-none hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
		>
			{summary}
		</summary>
		<pre
			class="mt-1 scrollbar-custom max-h-80 overflow-auto rounded-lg bg-gray-50 px-3 py-2 font-mono text-xs text-gray-700 dark:bg-gray-800 dark:text-gray-200">{pretty}</pre>
	</details>
{:else}
	<pre
		class="m-0 scrollbar-custom overflow-auto rounded-lg bg-gray-50 px-3 py-2 font-mono text-xs text-gray-700 dark:bg-gray-800 dark:text-gray-200">{pretty}</pre>
{/if}
