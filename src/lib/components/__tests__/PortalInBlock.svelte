<script lang="ts">
	import Modal from "../Modal.svelte";

	let { show = true, label }: { show?: boolean; label: string } = $props();
</script>

<!-- The shape every dialog in the app takes: a Modal inside a block. The
     block's end anchor stays in this tree, the Modal's backdrop fades out on
     teardown, and its content lives in body through Portal. -->
{#if show}
	<Modal><p data-portal={label}>{label}</p></Modal>
{/if}
