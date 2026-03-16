<script lang="ts">
	import Modal from "$lib/components/Modal.svelte";
	import ProjectKnowledgeFiles from "$lib/components/ProjectKnowledgeFiles.svelte";
	import { onMount } from "svelte";
	import { page } from "$app/state";
	import type { Model } from "$lib/types/Model";

	interface ProjectData {
		name: string;
		description?: string;
		preprompt?: string;
		modelId?: string;
	}

	interface Props {
		open?: boolean;
		/** Pass existing data when editing, omit for creation */
		initial?: ProjectData;
		/** Pass when editing to enable knowledge file management */
		projectId?: string;
		onclose?: () => void;
		onsave?: (data: ProjectData) => void;
	}

	let { open = false, initial, projectId, onclose, onsave }: Props = $props();

	let name = $state(initial?.name ?? "");
	let description = $state(initial?.description ?? "");
	let preprompt = $state(initial?.preprompt ?? "");
	let modelId = $state(initial?.modelId ?? "");
	let nameInputEl: HTMLInputElement | undefined = $state();

	const models: Model[] = page.data.models ?? [];
	const isEditing = $derived(!!initial);

	$effect(() => {
		if (open) {
			name = initial?.name ?? "";
			description = initial?.description ?? "";
			preprompt = initial?.preprompt ?? "";
			modelId = initial?.modelId ?? "";
		}
	});

	function close() {
		open = false;
		onclose?.();
	}

	function save() {
		const trimmedName = name.trim();
		if (!trimmedName) return;
		onsave?.({
			name: trimmedName,
			description: description.trim() || undefined,
			preprompt: preprompt.trim() || undefined,
			modelId: modelId || undefined,
		});
		close();
	}

	onMount(() => {
		setTimeout(() => {
			nameInputEl?.focus();
			if (isEditing) nameInputEl?.select();
		}, 0);
	});
</script>

{#if open}
	<Modal onclose={close} width="w-[90dvh] md:w-[520px]">
		<form
			class="flex w-full flex-col gap-5 p-6"
			onsubmit={(e) => {
				e.preventDefault();
				save();
			}}
		>
			<div class="flex items-start justify-between">
				<h2 class="text-xl font-semibold text-gray-800 dark:text-gray-200">
					{isEditing ? "Edit project" : "New project"}
				</h2>
				<button type="button" class="group" onclick={close} aria-label="Close">
					<svg
						xmlns="http://www.w3.org/2000/svg"
						viewBox="0 0 32 32"
						class="size-5 text-gray-700 group-hover:text-gray-500 dark:text-gray-300 dark:group-hover:text-gray-400"
					>
						<path
							d="M24 9.41 22.59 8 16 14.59 9.41 8 8 9.41 14.59 16 8 22.59 9.41 24 16 17.41 22.59 24 24 22.59 17.41 16 24 9.41z"
							fill="currentColor"
						/>
					</svg>
				</button>
			</div>

			<div class="flex flex-col gap-4">
				<div class="flex flex-col gap-1.5">
					<label for="project-name" class="text-sm text-gray-600 dark:text-gray-400">Name</label>
					<input
						autocomplete="off"
						id="project-name"
						bind:this={nameInputEl}
						value={name}
						oninput={(e) => (name = (e.currentTarget as HTMLInputElement).value)}
						class="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-[15px] text-gray-800 outline-none placeholder:text-gray-400 focus:ring-2 focus:ring-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:placeholder:text-gray-500 dark:focus:ring-gray-700"
						placeholder="e.g. ML Research"
					/>
				</div>

				<div class="flex flex-col gap-1.5">
					<label for="project-description" class="text-sm text-gray-600 dark:text-gray-400"
						>Description
						<span class="text-xs text-gray-400 dark:text-gray-500">(optional)</span></label
					>
					<input
						autocomplete="off"
						id="project-description"
						value={description}
						oninput={(e) => (description = (e.currentTarget as HTMLInputElement).value)}
						class="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-[15px] text-gray-800 outline-none placeholder:text-gray-400 focus:ring-2 focus:ring-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:placeholder:text-gray-500 dark:focus:ring-gray-700"
						placeholder="Short description of the project"
					/>
				</div>

				<div class="flex flex-col gap-1.5">
					<label for="project-preprompt" class="text-sm text-gray-600 dark:text-gray-400"
						>Custom instructions
						<span class="text-xs text-gray-400 dark:text-gray-500">(optional)</span></label
					>
					<textarea
						id="project-preprompt"
						value={preprompt}
						oninput={(e) => (preprompt = (e.currentTarget as HTMLTextAreaElement).value)}
						rows={3}
						class="w-full resize-y rounded-xl border border-gray-200 bg-white px-3 py-2 text-[15px] text-gray-800 outline-none placeholder:text-gray-400 focus:ring-2 focus:ring-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:placeholder:text-gray-500 dark:focus:ring-gray-700"
						placeholder="Instructions applied to all conversations in this project"
					></textarea>
				</div>

				{#if models.length > 1}
					<div class="flex flex-col gap-1.5">
						<label for="project-model" class="text-sm text-gray-600 dark:text-gray-400"
							>Default model
							<span class="text-xs text-gray-400 dark:text-gray-500">(optional)</span></label
						>
						<select
							id="project-model"
							value={modelId}
							onchange={(e) => (modelId = (e.currentTarget as HTMLSelectElement).value)}
							class="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-[15px] text-gray-800 outline-none focus:ring-2 focus:ring-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:focus:ring-gray-700"
						>
							<option value="">Use active model</option>
							{#each models.filter((m) => !m.unlisted) as m}
								<option value={m.id}>{m.name}</option>
							{/each}
						</select>
					</div>
				{/if}

				{#if isEditing && projectId}
					<ProjectKnowledgeFiles {projectId} />
				{/if}
			</div>

			<div class="flex items-center justify-end gap-2">
				<button
					type="button"
					class="inline-flex items-center rounded-xl border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-900 shadow hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-700 dark:text-gray-100 dark:hover:bg-gray-600"
					onclick={close}
				>
					Cancel
				</button>
				<button
					type="submit"
					class="inline-flex items-center rounded-xl border border-gray-900 bg-gray-900 px-3 py-1.5 text-sm font-semibold text-white hover:bg-black disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-100 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-white"
					disabled={!name.trim()}
				>
					{isEditing ? "Save" : "Create"}
				</button>
			</div>
		</form>
	</Modal>
{/if}
