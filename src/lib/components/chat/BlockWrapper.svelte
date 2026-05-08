<script lang="ts">
	import type { Snippet } from "svelte";

	interface Props {
		children: Snippet;
	}

	let { children }: Props = $props();
</script>

<div class="[.prose+&]:mt-3 [&:not(:last-child)]:mb-1.5 has-[+.prose]:!mb-3">
	{@render children()}
</div>
