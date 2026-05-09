<script lang="ts">
	import type { Snippet } from "svelte";

	interface Props {
		children: Snippet;
	}

	let { children }: Props = $props();
</script>

<div class="has-[+.prose]:!mb-2 [&:not(:last-child)]:mb-1 [.prose+&]:mt-3">
	{@render children()}
</div>
