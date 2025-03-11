<script lang="ts">
	import type { Message } from "$lib/types/Message";
	import CarbonTrashCan from "~icons/carbon/trash-can";
	import CarbonChevronLeft from "~icons/carbon/chevron-left";
	import CarbonChevronRight from "~icons/carbon/chevron-right";

	import { createEventDispatcher } from "svelte";
	import { base } from "$app/paths";
	import { page } from "$app/state";
	import { error } from "$lib/stores/errors";
	import { invalidate } from "$app/navigation";
	import { UrlDependency } from "$lib/types/UrlDependency";

	interface Props {
		message: Message;
		alternatives?: Message["id"][];
		loading?: boolean;
	}

	let { message, alternatives = [], loading = false }: Props = $props();

	let currentIdx = $derived(alternatives.findIndex((id) => id === message.id));

	const dispatch = createEventDispatcher<{
		showAlternateMsg: { id: Message["id"] };
	}>();
</script>

<div
	class="font-white group/navbranch z-0 -mt-1 ml-3.5 mr-auto flex h-6 w-fit select-none flex-row items-center justify-center gap-1 text-sm"
>
	<button
		class="inline text-lg font-thin text-gray-400 hover:text-gray-800 disabled:pointer-events-none disabled:opacity-25 dark:text-gray-500 dark:hover:text-gray-200"
		onclick={() => dispatch("showAlternateMsg", { id: alternatives[Math.max(0, currentIdx - 1)] })}
		disabled={currentIdx === 0 || loading}
	>
		<CarbonChevronLeft class="text-sm" />
	</button>
	<span class=" text-gray-400 dark:text-gray-500">
		{currentIdx + 1} / {alternatives.length}
	</span>
	<button
		class="inline text-lg font-thin text-gray-400 hover:text-gray-800 disabled:pointer-events-none disabled:opacity-25 dark:text-gray-500 dark:hover:text-gray-200"
		onclick={() =>
			dispatch("showAlternateMsg", {
				id: alternatives[Math.min(alternatives.length - 1, currentIdx + 1)],
			})}
		disabled={currentIdx === alternatives.length - 1 || loading}
	>
		<CarbonChevronRight class="text-sm" />
	</button>
	{#if !loading && message.children}
		<button
			class="hidden group-hover/navbranch:block"
			onclick={() => {
				if (confirm("Are you sure you want to delete this branch?")) {
					fetch(`${base}/api/conversation/${page.params.id}/message/${message.id}`, {
						method: "DELETE",
					}).then(async (r) => {
						if (r.ok) {
							await invalidate(UrlDependency.Conversation);
						} else {
							$error = (await r.json()).message;
						}
					});
				}
			}}
		>
			<div
				class="flex items-center justify-center text-xs text-gray-400 hover:text-gray-800 dark:text-gray-500 dark:hover:text-gray-200"
			>
				<CarbonTrashCan />
			</div>
		</button>
	{/if}
</div>
