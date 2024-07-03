<script lang="ts">
	import { base } from "$app/paths";
	import { afterNavigate, goto } from "$app/navigation";
	import Modal from "$lib/components/Modal.svelte";
	import ToolEdit from "../../ToolEdit.svelte";

	let previousPage: string = base;

	export let data;
	export let form;

	afterNavigate(({ from }) => {
		if (!from?.url.pathname.includes("tools/")) {
			previousPage = from?.url.toString() || previousPage;
		}
	});
</script>

<Modal
	on:close={() => goto(previousPage)}
	width="h-[95dvh] w-[90dvw] overflow-hidden rounded-2xl bg-white shadow-2xl outline-none sm:h-[85dvh] xl:w-[1200px] 2xl:h-[75dvh]"
>
	<ToolEdit
		bind:form
		tool={data.tool}
		readonly={!data.tool.createdByMe}
		on:close={() => goto(previousPage)}
	/>
</Modal>
