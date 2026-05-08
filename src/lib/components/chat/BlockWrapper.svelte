<script lang="ts">
	import type { Snippet } from "svelte";

	interface Props {
		children: Snippet;
	}

	let { children }: Props = $props();
</script>

<div class="[.prose+&]:mt-3 [&:not(:last-child)]:mb-2">
	{@render children()}
</div>
