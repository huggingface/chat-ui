<script lang="ts">
	import { base } from "$app/paths";
	import CarbonTrashCan from "~icons/carbon/trash-can";
	import CarbonDocumentAdd from "~icons/carbon/document-add";

	interface KnowledgeFile {
		_id: string;
		name: string;
		mime: string;
		sizeBytes: number;
		charCount: number;
		chunkCount: number;
		embeddingStatus: "pending" | "processing" | "done" | "failed";
		createdAt: string;
	}

	interface Props {
		projectId: string;
	}

	let { projectId }: Props = $props();

	let files = $state<KnowledgeFile[]>([]);
	let loading = $state(true);
	let uploading = $state(false);
	let errorMsg = $state("");
	let fileInputEl: HTMLInputElement | undefined = $state();

	async function loadFiles() {
		loading = true;
		try {
			const res = await fetch(`${base}/api/v2/projects/${projectId}/files`);
			if (res.ok) {
				const data = await res.json();
				files = data.json?.files ?? data.files ?? [];
			}
		} catch {
			// ignore
		}
		loading = false;
	}

	async function uploadFile(file: File) {
		uploading = true;
		errorMsg = "";
		try {
			const formData = new FormData();
			formData.append("file", file);
			const res = await fetch(`${base}/api/v2/projects/${projectId}/files`, {
				method: "POST",
				body: formData,
			});
			if (!res.ok) {
				const body = await res.json().catch(() => ({}));
				errorMsg = body.json?.message ?? body.message ?? "Upload failed";
			} else {
				await loadFiles();
			}
		} catch {
			errorMsg = "Upload failed";
		}
		uploading = false;
	}

	async function deleteFile(fileId: string) {
		try {
			const res = await fetch(`${base}/api/v2/projects/${projectId}/files/${fileId}`, {
				method: "DELETE",
			});
			if (res.ok) {
				files = files.filter((f) => f._id !== fileId);
			}
		} catch {
			// ignore
		}
	}

	function formatSize(bytes: number): string {
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	}

	function statusLabel(s: KnowledgeFile["embeddingStatus"]): string {
		switch (s) {
			case "pending":
				return "Pending";
			case "processing":
				return "Embedding...";
			case "done":
				return "Ready";
			case "failed":
				return "Failed";
		}
	}

	function statusColor(s: KnowledgeFile["embeddingStatus"]): string {
		switch (s) {
			case "pending":
				return "text-yellow-600 dark:text-yellow-400";
			case "processing":
				return "text-blue-600 dark:text-blue-400";
			case "done":
				return "text-green-600 dark:text-green-400";
			case "failed":
				return "text-red-600 dark:text-red-400";
		}
	}

	$effect(() => {
		if (projectId) {
			loadFiles();
		}
	});
</script>

<div class="flex flex-col gap-3">
	<div class="flex items-center justify-between">
		<span class="text-sm text-gray-600 dark:text-gray-400">
			Knowledge files
			<span class="text-xs text-gray-400 dark:text-gray-500">(optional)</span>
		</span>
		<button
			type="button"
			class="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
			disabled={uploading}
			onclick={() => fileInputEl?.click()}
		>
			<CarbonDocumentAdd class="text-xs" />
			{uploading ? "Uploading..." : "Upload"}
		</button>
		<input
			bind:this={fileInputEl}
			type="file"
			class="hidden"
			accept=".txt,.md,.csv,.json,.xml,.html,.pdf,.yaml,.yml,.toml"
			onchange={(e) => {
				const input = e.currentTarget as HTMLInputElement;
				const file = input.files?.[0];
				if (file) {
					uploadFile(file);
					input.value = "";
				}
			}}
		/>
	</div>

	{#if errorMsg}
		<p class="text-xs text-red-600 dark:text-red-400">{errorMsg}</p>
	{/if}

	{#if loading}
		<p class="text-xs text-gray-400">Loading...</p>
	{:else if files.length === 0}
		<p class="text-xs text-gray-400 dark:text-gray-500">
			Upload files to share knowledge across all conversations in this project.
		</p>
	{:else}
		<div class="flex flex-col gap-1.5">
			{#each files as file (file._id)}
				<div
					class="flex items-center gap-2 rounded-lg border border-gray-100 px-2.5 py-1.5 text-xs dark:border-gray-700"
				>
					<div class="min-w-0 flex-1">
						<div class="truncate font-medium text-gray-800 dark:text-gray-200">{file.name}</div>
						<div class="flex gap-2 text-gray-400 dark:text-gray-500">
							<span>{formatSize(file.sizeBytes)}</span>
							<span>{file.charCount.toLocaleString()} chars</span>
							<span class={statusColor(file.embeddingStatus)}
								>{statusLabel(file.embeddingStatus)}</span
							>
						</div>
					</div>
					<button
						type="button"
						class="flex size-5 items-center justify-center rounded hover:bg-gray-100 dark:hover:bg-gray-700"
						title="Delete file"
						onclick={() => deleteFile(file._id)}
					>
						<CarbonTrashCan
							class="text-xs text-gray-400 hover:text-gray-500 dark:hover:text-gray-300"
						/>
					</button>
				</div>
			{/each}
		</div>
	{/if}
</div>
