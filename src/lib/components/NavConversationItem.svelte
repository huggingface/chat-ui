<script lang="ts">
	import { base } from "$app/paths";
	import { page } from "$app/state";
	import { tick } from "svelte";
	import { browser } from "$app/environment";

	import CarbonTrashCan from "~icons/carbon/trash-can";
	import CarbonEdit from "~icons/carbon/edit";
	import type { ConvSidebar } from "$lib/types/ConvSidebar";

	import EditConversationModal from "$lib/components/EditConversationModal.svelte";
	import DeleteConversationModal from "$lib/components/DeleteConversationModal.svelte";
	import { requireAuthUser } from "$lib/utils/auth";
	import { dragState, startDrag, setDropTarget } from "$lib/stores/dragState";

	interface Props {
		conv: ConvSidebar;
		readOnly?: true;
		groupId?: string;
		ondeleteConversation?: (id: string) => void;
		oneditConversationTitle?: (payload: { id: string; title: string }) => void;
	}

	let { conv, readOnly, groupId, ondeleteConversation, oneditConversationTitle }: Props = $props();

	let deleteOpen = $state(false);
	let renameOpen = $state(false);
	let inlineEditing = $state(false);
	let inlineCancelled = $state(false);
	let inlineTitle = $state("");
	let inputEl: HTMLInputElement | undefined = $state();

	// Drag state
	let pointerStartPos: { x: number; y: number } | null = null;
	let longPressTimer: ReturnType<typeof setTimeout> | null = null;
	let isDragSource = $derived($dragState.isDragging && $dragState.draggedConv?.id === conv.id);
	let isDropTargetConv = $derived(
		$dragState.isDragging &&
			$dragState.dropTarget?.type === "conversation" &&
			$dragState.dropTarget?.id === conv.id.toString()
	);

	async function startInlineEdit() {
		if (readOnly || requireAuthUser()) return;
		inlineTitle = conv.title;
		inlineCancelled = false;
		inlineEditing = true;
		await tick();
		inputEl?.focus();
		inputEl?.select();
	}

	function commitInlineEdit() {
		if (!inlineEditing || inlineCancelled) return;
		const trimmed = inlineTitle.trim();
		inlineEditing = false;
		if (trimmed && trimmed !== conv.title) {
			oneditConversationTitle?.({ id: conv.id.toString(), title: trimmed });
		}
	}

	function cancelInlineEdit() {
		inlineCancelled = true;
		inlineEditing = false;
	}

	function clearLongPress() {
		if (longPressTimer) {
			clearTimeout(longPressTimer);
			longPressTimer = null;
		}
	}

	function isMobile() {
		return browser && window.matchMedia("(max-width: 768px)").matches;
	}

	function handlePointerDown(e: PointerEvent) {
		if (readOnly || inlineEditing || e.button !== 0) return;
		pointerStartPos = { x: e.clientX, y: e.clientY };

		if (isMobile()) {
			longPressTimer = setTimeout(() => {
				if (pointerStartPos) {
					startDrag(conv, pointerStartPos.x, pointerStartPos.y, groupId);
					if (navigator.vibrate) navigator.vibrate(50);
				}
			}, 500);
		}
	}

	function handlePointerMove(e: PointerEvent) {
		if (!pointerStartPos) return;

		const dx = e.clientX - pointerStartPos.x;
		const dy = e.clientY - pointerStartPos.y;
		const dist = Math.sqrt(dx * dx + dy * dy);

		if ($dragState.isDragging) {
			// Already dragging — this is handled by NavMenu's global pointermove
			return;
		}

		if (isMobile()) {
			// Cancel long press if moved too far
			if (dist > 5) {
				clearLongPress();
				pointerStartPos = null;
			}
		} else {
			// Desktop: start drag after 5px movement
			if (dist > 5) {
				startDrag(conv, e.clientX, e.clientY, groupId);
			}
		}
	}

	function handlePointerUp() {
		clearLongPress();
		pointerStartPos = null;
	}

	function handlePointerEnter() {
		if ($dragState.isDragging && $dragState.draggedConv?.id !== conv.id) {
			// Don't allow dropping onto a conversation in the same group
			if (groupId && $dragState.sourceGroupId === groupId) return;
			setDropTarget({ type: "conversation", id: conv.id.toString() });
		}
	}

	function handlePointerLeave() {
		if ($dragState.isDragging && $dragState.dropTarget?.id === conv.id.toString()) {
			setDropTarget(null);
		}
	}
</script>

<a
	data-sveltekit-noscroll
	data-sveltekit-preload-data="tap"
	data-conv-id={conv.id}
	draggable="false"
	href="{base}/conversation/{conv.id}"
	class="group flex h-[2.15rem] flex-none items-center gap-1.5 rounded-lg pl-2.5 pr-2 text-gray-600 transition-all duration-150 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700 max-sm:h-10
		{conv.id === page.params.id ? 'bg-gray-100 dark:bg-gray-700' : ''}
		{isDragSource ? 'pointer-events-none opacity-40' : ''}
		{isDropTargetConv ? 'bg-blue-50 ring-2 ring-blue-400 dark:bg-blue-900/20' : ''}"
	onclick={(e) => {
		if ($dragState.isDragging) {
			e.preventDefault();
			return;
		}
		if (e.detail >= 2) {
			e.preventDefault();
			startInlineEdit();
		}
	}}
	onpointerdown={handlePointerDown}
	onpointermove={handlePointerMove}
	onpointerup={handlePointerUp}
	onpointercancel={handlePointerUp}
	onpointerenter={handlePointerEnter}
	onpointerleave={handlePointerLeave}
>
	{#if inlineEditing}
		<input
			bind:this={inputEl}
			type="text"
			value={inlineTitle}
			oninput={(e) => (inlineTitle = (e.currentTarget as HTMLInputElement).value)}
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
			onclick={(e) => e.preventDefault()}
			class="my-0 h-full min-w-0 flex-1 truncate border-none bg-transparent p-0 text-inherit outline-none first-letter:uppercase focus:ring-0"
		/>
	{:else}
		<div class="my-2 min-w-0 flex-1 truncate first-letter:uppercase">
			<span>{conv.title}</span>
		</div>
	{/if}

	{#if !readOnly && !inlineEditing && !$dragState.isDragging}
		<button
			type="button"
			class="flex h-5 w-5 items-center justify-center rounded md:hidden md:group-hover:flex"
			title="Edit conversation title"
			onclick={(e) => {
				e.preventDefault();
				if (requireAuthUser()) return;
				renameOpen = true;
			}}
		>
			<CarbonEdit class="text-xs text-gray-400 hover:text-gray-500 dark:hover:text-gray-300" />
		</button>

		<button
			type="button"
			class="flex h-5 w-5 items-center justify-center rounded md:hidden md:group-hover:flex"
			title="Delete conversation"
			onclick={(event) => {
				event.preventDefault();
				if (requireAuthUser()) return;
				if (event.shiftKey) {
					ondeleteConversation?.(conv.id.toString());
				} else {
					deleteOpen = true;
				}
			}}
		>
			<CarbonTrashCan class="text-xs text-gray-400  hover:text-gray-500 dark:hover:text-gray-300" />
		</button>
	{/if}
</a>

<!-- Edit title modal -->
{#if renameOpen}
	<EditConversationModal
		open={renameOpen}
		title={conv.title}
		onclose={() => (renameOpen = false)}
		onsave={(payload) => {
			renameOpen = false;
			oneditConversationTitle?.({ id: conv.id.toString(), title: payload.title });
		}}
	/>
{/if}

<!-- Delete confirmation modal -->
{#if deleteOpen}
	<DeleteConversationModal
		open={deleteOpen}
		title={conv.title}
		onclose={() => (deleteOpen = false)}
		ondelete={() => {
			deleteOpen = false;
			ondeleteConversation?.(conv.id.toString());
		}}
	/>
{/if}
