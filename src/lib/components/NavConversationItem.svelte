<script lang="ts">
	import { base } from "$app/paths";
	import { page } from "$app/state";
	import { tick } from "svelte";
	import { DropdownMenu } from "bits-ui";

	import CarbonTrashCan from "~icons/carbon/trash-can";
	import CarbonEdit from "~icons/carbon/edit";
	import LucideEllipsis from "~icons/lucide/ellipsis";
	import type { ConvSidebar } from "$lib/types/ConvSidebar";

	import EditConversationModal from "$lib/components/EditConversationModal.svelte";
	import DeleteConversationModal from "$lib/components/DeleteConversationModal.svelte";
	import { requireAuthUser } from "$lib/utils/auth";

	interface Props {
		conv: ConvSidebar;
		readOnly?: true;
		ondeleteConversation?: (id: string) => void;
		oneditConversationTitle?: (payload: { id: string; title: string }) => void;
	}

	let { conv, readOnly, ondeleteConversation, oneditConversationTitle }: Props = $props();

	let deleteOpen = $state(false);
	let renameOpen = $state(false);
	let isMenuOpen = $state(false);
	let inlineEditing = $state(false);
	let inlineCancelled = $state(false);
	let inlineTitle = $state("");
	let inputEl: HTMLInputElement | undefined = $state();

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
</script>

<div
	class="group flex h-8 flex-none items-center gap-1.5 rounded-lg pl-2 pr-1.5 text-base text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700 max-sm:h-10 sm:text-sm
		{conv.id === page.params.id ? 'bg-gray-100 dark:bg-gray-700' : ''}"
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
			class="my-0 h-full min-w-0 flex-1 truncate border-none bg-transparent p-0 text-inherit outline-none first-letter:uppercase focus:ring-0"
		/>
	{:else}
		<a
			data-sveltekit-noscroll
			data-sveltekit-preload-data="tap"
			href="{base}/conversation/{conv.id}"
			class="min-w-0 flex-1 truncate py-2 first-letter:uppercase"
			onclick={(e) => {
				if (e.detail >= 2) {
					e.preventDefault();
					startInlineEdit();
				}
			}}
		>
			<span>{conv.title}</span>
		</a>

		{#if !readOnly}
			<DropdownMenu.Root
				bind:open={isMenuOpen}
				onOpenChange={(open) => {
					if (open && requireAuthUser()) {
						isMenuOpen = false;
						return;
					}
					isMenuOpen = open;
				}}
			>
				<DropdownMenu.Trigger
					class="flex h-6 w-6 items-center justify-center rounded-md text-gray-400 data-[state=open]:bg-gray-200 data-[state=open]:text-gray-600 hover:bg-gray-200 hover:text-gray-600 dark:data-[state=open]:bg-gray-600 dark:data-[state=open]:text-gray-200 dark:hover:bg-gray-600 dark:hover:text-gray-200 md:hidden md:group-hover:flex md:data-[state=open]:flex"
					aria-label="Conversation actions"
					title="More options"
				>
					<LucideEllipsis class="text-sm" />
				</DropdownMenu.Trigger>
				<DropdownMenu.Portal>
					<DropdownMenu.Content
						class="z-50 min-w-[9rem] rounded-xl border border-gray-200 bg-white/95 p-1 text-gray-800 shadow-lg backdrop-blur dark:border-gray-700/60 dark:bg-gray-800/95 dark:text-gray-100"
						side="bottom"
						align="end"
						sideOffset={4}
						trapFocus={false}
						onCloseAutoFocus={(e) => e.preventDefault()}
						interactOutsideBehavior="defer-otherwise-close"
					>
						<DropdownMenu.Item
							class="flex h-9 select-none items-center gap-2 rounded-md px-2 text-sm text-gray-700 data-[highlighted]:bg-gray-100 focus-visible:outline-none dark:text-gray-200 dark:data-[highlighted]:bg-white/10 sm:h-8"
							onSelect={() => (renameOpen = true)}
						>
							<CarbonEdit class="size-4 opacity-90 dark:opacity-80" />
							Rename
						</DropdownMenu.Item>
						<DropdownMenu.Item
							class="flex h-9 select-none items-center gap-2 rounded-md px-2 text-sm text-red-500 data-[highlighted]:bg-red-50 data-[highlighted]:text-red-600 focus-visible:outline-none dark:text-red-400 dark:data-[highlighted]:bg-red-500/10 dark:data-[highlighted]:text-red-400 sm:h-8"
							onSelect={() => (deleteOpen = true)}
						>
							<CarbonTrashCan class="size-4 opacity-90 dark:opacity-80" />
							Delete
						</DropdownMenu.Item>
					</DropdownMenu.Content>
				</DropdownMenu.Portal>
			</DropdownMenu.Root>
		{/if}
	{/if}
</div>

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
