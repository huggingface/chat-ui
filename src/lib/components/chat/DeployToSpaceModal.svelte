<script lang="ts">
	import { base } from "$app/paths";
	import Modal from "$lib/components/Modal.svelte";
	import { useAPIClient, handleResponse } from "$lib/APIClient";
	import type { ArtifactKind } from "$lib/utils/artifacts";

	import CarbonClose from "~icons/carbon/close";
	import CarbonRocket from "~icons/carbon/rocket";
	import CarbonArrowUpRight from "~icons/carbon/arrow-up-right";
	import CarbonCheckmark from "~icons/carbon/checkmark";
	import EosIconsLoading from "~icons/eos-icons/loading";

	interface Existing {
		repoId: string;
		url: string;
	}

	interface Props {
		conversationId: string;
		artifactIdentifier: string;
		title: string;
		kind: ArtifactKind;
		content: string;
		existing?: Existing;
		onclose?: () => void;
		ondeployed?: (deployment: { repoId: string; url: string }) => void;
	}

	let {
		conversationId,
		artifactIdentifier,
		title,
		kind,
		content,
		existing,
		onclose,
		ondeployed,
	}: Props = $props();

	const client = useAPIClient();

	// svelte-ignore state_referenced_locally
	let spaceTitle = $state(title);
	let visibility = $state<"public" | "private">("public");

	type DeployState = "idle" | "deploying" | "success" | "error" | "reauth";
	let deployState = $state<DeployState>("idle");
	// svelte-ignore state_referenced_locally
	let resultUrl = $state(existing?.url ?? "");
	let errorMessage = $state("");

	const isUpdate = $derived(!!existing);

	function close() {
		onclose?.();
	}

	async function deploy() {
		deployState = "deploying";
		errorMessage = "";
		try {
			const res = await client.spaces.deploy.post({
				conversationId,
				artifactIdentifier,
				title: spaceTitle.trim() || title,
				kind,
				content,
				visibility,
			});

			// 401/403 → the OAuth token lacks Space-creation permission (or there's no
			// HF session yet); send the user through the OAuth flow to grant it.
			if (res.status === 401 || res.status === 403) {
				deployState = "reauth";
				return;
			}

			const data = handleResponse(res) as { repoId: string; url: string; created: boolean };
			resultUrl = data.url;
			deployState = "success";
			ondeployed?.({ repoId: data.repoId, url: data.url });
		} catch (e) {
			deployState = "error";
			errorMessage = e instanceof Error ? e.message : "Something went wrong. Please try again.";
		}
	}

	function reauthorize() {
		const next = encodeURIComponent(window.location.pathname + window.location.search);
		window.location.assign(`${base}/login?next=${next}`);
	}
</script>

<Modal onclose={close} width="w-[90dvw] md:w-[480px]">
	<div class="flex w-full flex-col gap-5 p-6">
		<div class="flex items-start justify-between">
			<h2 class="flex items-center gap-2 text-xl font-semibold text-gray-800 dark:text-gray-200">
				<CarbonRocket class="text-lg text-gray-500 dark:text-gray-400" />
				{isUpdate ? "Update Space" : "Deploy to a Space"}
			</h2>
			<button type="button" class="group outline-hidden" onclick={close} aria-label="Close">
				<CarbonClose
					class="size-5 text-gray-700 group-hover:text-gray-500 dark:text-gray-300 dark:group-hover:text-gray-400"
				/>
			</button>
		</div>

		{#if deployState === "success"}
			<div class="flex flex-col gap-4">
				<p class="flex items-center gap-2 text-sm font-medium text-green-700 dark:text-green-400">
					<CarbonCheckmark class="size-4" />
					{isUpdate ? "Your Space was updated." : "Your Space is live."}
				</p>
				<p class="text-sm text-gray-600 dark:text-gray-400">
					It may take a few seconds for the Space to build. Public Spaces can be shared with anyone.
				</p>
				<div class="flex items-center justify-end gap-2">
					<button
						type="button"
						class="inline-flex items-center rounded-xl border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-900 shadow-sm outline-hidden hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-700 dark:text-gray-100 dark:hover:bg-gray-600"
						onclick={close}
					>
						Done
					</button>
					<a
						href={resultUrl}
						target="_blank"
						rel="noopener noreferrer"
						class="inline-flex items-center gap-1.5 rounded-xl border border-gray-900 bg-gray-900 px-3 py-1.5 text-sm font-semibold text-white hover:bg-black focus:ring-2 focus:ring-gray-400 focus:ring-offset-2 focus:outline-hidden dark:border-gray-100 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-white dark:focus:ring-offset-gray-800"
					>
						Open Space
						<CarbonArrowUpRight class="size-3.5" />
					</a>
				</div>
			</div>
		{:else if deployState === "reauth"}
			<div class="flex flex-col gap-4">
				<p class="text-sm text-gray-600 dark:text-gray-400">
					To deploy artifacts, HuggingChat needs permission to create Spaces on your Hugging Face
					account. Sign in again to grant it. It can only access Spaces it creates for you, not your
					other repositories.
				</p>
				<div class="flex items-center justify-end gap-2">
					<button
						type="button"
						class="inline-flex items-center rounded-xl border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-900 shadow-sm outline-hidden hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-700 dark:text-gray-100 dark:hover:bg-gray-600"
						onclick={close}
					>
						Cancel
					</button>
					<button
						type="button"
						class="inline-flex items-center gap-1.5 rounded-xl border border-gray-900 bg-gray-900 px-3 py-1.5 text-sm font-semibold text-white hover:bg-black focus:ring-2 focus:ring-gray-400 focus:ring-offset-2 focus:outline-hidden dark:border-gray-100 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-white dark:focus:ring-offset-gray-800"
						onclick={reauthorize}
					>
						Sign in to continue
					</button>
				</div>
			</div>
		{:else}
			<div class="flex flex-col gap-4">
				<label class="flex flex-col gap-1.5">
					<span class="text-sm font-medium text-gray-700 dark:text-gray-300">Space name</span>
					<input
						type="text"
						bind:value={spaceTitle}
						maxlength="100"
						disabled={deployState === "deploying" || isUpdate}
						placeholder="My artifact"
						class="rounded-xl border border-gray-200 bg-white px-3.5 py-2 text-sm text-gray-800 outline-hidden focus:border-gray-400 disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
					/>
					{#if isUpdate && existing}
						<span class="font-mono text-xs text-gray-500 dark:text-gray-400">{existing.repoId}</span
						>
					{/if}
				</label>

				{#if !isUpdate}
					<fieldset class="flex flex-col gap-2">
						<span class="text-sm font-medium text-gray-700 dark:text-gray-300">Visibility</span>
						<div class="flex gap-2">
							<label
								class="flex flex-1 cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm {visibility ===
								'public'
									? 'border-gray-900 bg-gray-50 dark:border-gray-100 dark:bg-gray-800'
									: 'border-gray-200 dark:border-gray-700'}"
							>
								<input
									type="radio"
									name="visibility"
									value="public"
									bind:group={visibility}
									class="accent-gray-900 dark:accent-gray-100"
								/>
								<span class="text-gray-800 dark:text-gray-200">Public</span>
							</label>
							<label
								class="flex flex-1 cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm {visibility ===
								'private'
									? 'border-gray-900 bg-gray-50 dark:border-gray-100 dark:bg-gray-800'
									: 'border-gray-200 dark:border-gray-700'}"
							>
								<input
									type="radio"
									name="visibility"
									value="private"
									bind:group={visibility}
									class="accent-gray-900 dark:accent-gray-100"
								/>
								<span class="text-gray-800 dark:text-gray-200">Private</span>
							</label>
						</div>
					</fieldset>
				{/if}

				{#if deployState === "error"}
					<p
						class="rounded-xl border border-red-300/60 bg-red-50 px-3.5 py-2.5 text-xs break-words text-red-600 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-400"
					>
						{errorMessage}
					</p>
				{/if}

				<div class="flex items-center justify-end gap-2">
					<button
						type="button"
						class="inline-flex items-center rounded-xl border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-900 shadow-sm outline-hidden hover:bg-gray-50 disabled:opacity-60 dark:border-gray-700 dark:bg-gray-700 dark:text-gray-100 dark:hover:bg-gray-600"
						disabled={deployState === "deploying"}
						onclick={close}
					>
						Cancel
					</button>
					<button
						type="button"
						class="inline-flex items-center gap-1.5 rounded-xl border border-gray-900 bg-gray-900 px-3 py-1.5 text-sm font-semibold text-white hover:bg-black focus:ring-2 focus:ring-gray-400 focus:ring-offset-2 focus:outline-hidden disabled:opacity-60 dark:border-gray-100 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-white dark:focus:ring-offset-gray-800"
						disabled={deployState === "deploying"}
						onclick={deploy}
					>
						{#if deployState === "deploying"}
							<EosIconsLoading class="size-3.5" />
							{isUpdate ? "Updating…" : "Deploying…"}
						{:else}
							<CarbonRocket class="size-3.5" />
							{isUpdate ? "Update Space" : "Deploy"}
						{/if}
					</button>
				</div>
			</div>
		{/if}
	</div>
</Modal>
