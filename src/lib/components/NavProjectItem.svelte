<script lang="ts">
	import CarbonCheckmark from "~icons/carbon/checkmark";
	import CarbonTrashCan from "~icons/carbon/trash-can";
	import CarbonClose from "~icons/carbon/close";
	import CarbonEdit from "~icons/carbon/edit";
	import CarbonFolder from "~icons/carbon/folder";
	import { requireAuthUser } from "$lib/utils/auth";

	interface ProjectSidebar {
		id: string;
		name: string;
		description?: string;
		preprompt?: string;
		modelId?: string;
		updatedAt: Date;
		conversationCount: number;
	}

	interface Props {
		project: ProjectSidebar;
		isActive?: boolean;
		onclick?: (id: string) => void;
		onedit?: (id: string) => void;
		ondelete?: (id: string) => void;
	}

	let { project, isActive = false, onclick, onedit, ondelete }: Props = $props();

	let confirmDelete = $state(false);
</script>

<button
	type="button"
	onmouseleave={() => {
		confirmDelete = false;
	}}
	onclick={() => onclick?.(project.id)}
	class="group flex h-[2.15rem] w-full flex-none items-center gap-1.5 rounded-lg pl-2.5 pr-2 text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700 max-sm:h-10
		{isActive ? 'bg-gray-100 dark:bg-gray-700' : ''}"
>
	<CarbonFolder class="flex-none text-xs text-gray-400 dark:text-gray-500" />
	<div class="my-2 min-w-0 flex-1 truncate text-left">
		{#if confirmDelete}
			<span class="mr-1 font-semibold">Delete?</span>
		{/if}
		{project.name}
	</div>

	{#if confirmDelete}
		<button
			type="button"
			class="flex h-5 w-5 items-center justify-center rounded md:hidden md:group-hover:flex"
			title="Cancel delete action"
			onclick={(e) => {
				e.stopPropagation();
				if (requireAuthUser()) return;
				confirmDelete = false;
			}}
		>
			<CarbonClose class="text-xs text-gray-400 hover:text-gray-500 dark:hover:text-gray-300" />
		</button>
		<button
			type="button"
			class="flex h-5 w-5 items-center justify-center rounded md:hidden md:group-hover:flex"
			title="Confirm delete action"
			onclick={(e) => {
				e.stopPropagation();
				if (requireAuthUser()) return;
				confirmDelete = false;
				ondelete?.(project.id);
			}}
		>
			<CarbonCheckmark class="text-xs text-gray-400 hover:text-gray-500 dark:hover:text-gray-300" />
		</button>
	{:else}
		<span
			class="rounded-md bg-gray-500/5 px-1.5 py-0.5 text-xs text-gray-400 dark:bg-gray-500/20 dark:text-gray-400 md:group-hover:hidden"
		>
			{project.conversationCount}
		</span>
		<button
			type="button"
			class="hidden h-5 w-5 items-center justify-center rounded md:group-hover:flex"
			title="Edit project"
			onclick={(e) => {
				e.stopPropagation();
				if (requireAuthUser()) return;
				onedit?.(project.id);
			}}
		>
			<CarbonEdit class="text-xs text-gray-400 hover:text-gray-500 dark:hover:text-gray-300" />
		</button>
		<button
			type="button"
			class="hidden h-5 w-5 items-center justify-center rounded md:group-hover:flex"
			title="Delete project"
			onclick={(e) => {
				e.stopPropagation();
				if (requireAuthUser()) return;
				if (e.shiftKey) {
					ondelete?.(project.id);
				} else {
					confirmDelete = true;
				}
			}}
		>
			<CarbonTrashCan class="text-xs text-gray-400 hover:text-gray-500 dark:hover:text-gray-300" />
		</button>
	{/if}
</button>
