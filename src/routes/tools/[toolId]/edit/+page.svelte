<script lang="ts">
	import Modal from "$lib/components/Modal.svelte";
	import ToolEdit from "../../ToolEdit.svelte";

	let { data } = $props();
</script>

<Modal
	on:close={() => window.history.back()}
	width="h-[95dvh] w-[90dvw] overflow-hidden rounded-2xl bg-white shadow-2xl outline-none sm:h-[85dvh] xl:w-[1200px] 2xl:h-[75dvh]"
	closeButton
>
	<ToolEdit
		tool={data.tool}
		readonly={!data.tool.createdByMe}
		on:close={() => {
			window.history.back();
		}}
	/>
</Modal>
