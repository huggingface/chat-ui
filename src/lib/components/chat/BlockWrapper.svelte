<script lang="ts">
	import type { Snippet } from "svelte";

	interface Props {
		children: Snippet;
	}

	let { children }: Props = $props();
</script>

<div class="not-last:mb-1 has-[+.prose]:mb-2! [.prose+&]:mt-3">
	{@render children()}
</div>
