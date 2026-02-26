<script lang="ts">
	import { tick } from "svelte";
	import CarbonChevronDown from "~icons/carbon/chevron-down";
	import CarbonChevronRight from "~icons/carbon/chevron-right";
	import CarbonEdit from "~icons/carbon/edit";
	import CarbonTrashCan from "~icons/carbon/trash-can";
	import NavConversationItem from "./NavConversationItem.svelte";
	import DeleteConversationModal from "$lib/components/DeleteConversationModal.svelte";
	import type { ConvGroupSidebar } from "$lib/types/ConvGroupSidebar";
	import { dragState, setDropTarget } from "$lib/stores/dragState";
	import { requireAuthUser } from "$lib/utils/auth";

	interface Props {
		group: ConvGroupSidebar;
		ondeleteGroup?: (id: string) => void;
		oneditGroupName?: (payload: { id: string; name: string }) => void;
		ontoggleCollapse?: (payload: { id: string; isCollapsed: boolean }) => void;
		ondeleteConversation?: (id: string) => void;
		oneditConversationTitle?: (payload: { id: string; title: string }) => void;
	}

	let {
		group,
		ondeleteGroup,
		oneditGroupName,
		ontoggleCollapse,
		ondeleteConversation,
		oneditConversationTitle,
	}: Props = $props();

	let deleteOpen = $state(false);
	let inlineEditing = $state(false);
	let inlineCancelled = $state(false);
	let inlineName = $state("");
	let inputEl: HTMLInputElement | undefined = $state();

	async function startInlineEdit() {
		if (requireAuthUser()) return;
		inlineName = group.name;
		inlineCancelled = false;
		inlineEditing = true;
		await tick();
		inputEl?.focus();
		inputEl?.select();
	}

	function commitInlineEdit() {
		if (!inlineEditing || inlineCancelled) return;
		const trimmed = inlineName.trim();
		inlineEditing = false;
		if (trimmed && trimmed !== group.name) {
			oneditGroupName?.({ id: group.id, name: trimmed });
		}
	}

	function cancelInlineEdit() {
		inlineCancelled = true;
		inlineEditing = false;
	}

	function handleToggle() {
		ontoggleCollapse?.({ id: group.id, isCollapsed: !group.isCollapsed });
	}

	let isDropTarget = $derived(
		$dragState.isDragging &&
			$dragState.dropTarget?.type === "group" &&
			$dragState.dropTarget?.id === group.id
	);

	function handlePointerEnter() {
		if ($dragState.isDragging) {
			// Don't allow dropping onto the same group the conv is from
			if ($dragState.sourceGroupId === group.id) return;
			setDropTarget({ type: "group", id: group.id });
		}
	}

	function handlePointerLeave() {
		if ($dragState.isDragging && $dragState.dropTarget?.id === group.id) {
			setDropTarget(null);
		}
	}
</script>

<div
	class="rounded-lg border-l-2 border-blue-400 dark:border-blue-500
		{isDropTarget ? 'bg-blue-50 ring-2 ring-blue-400 dark:bg-blue-900/20' : ''}"
>
	<div
		class="group flex h-[2.15rem] flex-none cursor-pointer items-center gap-1 rounded-lg pl-1 pr-2 text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700 max-sm:h-10"
		role="button"
		tabindex="0"
		data-group-id={group.id}
		onclick={(e) => {
			if (e.detail >= 2) {
				e.preventDefault();
				startInlineEdit();
			} else if (!inlineEditing) {
				handleToggle();
			}
		}}
		onkeydown={(e) => {
			if (e.key === "Enter" || e.key === " ") {
				e.preventDefault();
				handleToggle();
			}
		}}
		onpointerenter={handlePointerEnter}
		onpointerleave={handlePointerLeave}
	>
		<span class="flex size-4 items-center justify-center text-gray-400">
			{#if group.isCollapsed}
				<CarbonChevronRight class="text-xs" />
			{:else}
				<CarbonChevronDown class="text-xs" />
			{/if}
		</span>

		{#if inlineEditing}
			<input
				bind:this={inputEl}
				type="text"
				value={inlineName}
				oninput={(e) => (inlineName = (e.currentTarget as HTMLInputElement).value)}
				onkeydown={(e) => {
					if (e.key === "Enter") {
						e.preventDefault();
						commitInlineEdit();
					} else if (e.key === "Escape") {
						e.preventDefault();
						cancelInlineEdit();
					}
				}}
				onblur={commitInlineEdit}
				onclick={(e) => e.stopPropagation()}
				class="my-0 h-full min-w-0 flex-1 truncate border-none bg-transparent p-0 text-sm font-semibold text-inherit outline-none focus:ring-0"
			/>
		{:else}
			<span class="min-w-0 flex-1 truncate text-sm font-semibold">{group.name}</span>
		{/if}

		<span
			class="ml-auto rounded-md bg-gray-500/10 px-1.5 py-0.5 text-xs text-gray-400 dark:bg-gray-500/20"
		>
			{group.conversations.length}
		</span>

		{#if !inlineEditing}
			<button
				type="button"
				class="flex h-5 w-5 items-center justify-center rounded md:hidden md:group-hover:flex"
				title="Rename group"
				onclick={(e) => {
					e.stopPropagation();
					startInlineEdit();
				}}
			>
				<CarbonEdit class="text-xs text-gray-400 hover:text-gray-500 dark:hover:text-gray-300" />
			</button>

			<button
				type="button"
				class="flex h-5 w-5 items-center justify-center rounded md:hidden md:group-hover:flex"
				title="Delete group"
				onclick={(e) => {
					e.stopPropagation();
					if (requireAuthUser()) return;
					if (e.shiftKey) {
						ondeleteGroup?.(group.id);
					} else {
						deleteOpen = true;
					}
				}}
			>
				<CarbonTrashCan
					class="text-xs text-gray-400 hover:text-gray-500 dark:hover:text-gray-300"
				/>
			</button>
		{/if}
	</div>

	{#if !group.isCollapsed}
		<div class="flex flex-col gap-0.5 pl-3">
			{#each group.conversations as conv}
				<NavConversationItem
					{conv}
					{ondeleteConversation}
					{oneditConversationTitle}
					groupId={group.id}
				/>
			{/each}
		</div>
	{/if}
</div>

{#if deleteOpen}
	<DeleteConversationModal
		open={deleteOpen}
		title={`group "${group.name}" (${group.conversations.length} conversations will be ungrouped)`}
		onclose={() => (deleteOpen = false)}
		ondelete={() => {
			deleteOpen = false;
			ondeleteGroup?.(group.id);
		}}
	/>
{/if}
