<script lang="ts">
	import CarbonTrashCan from "~icons/carbon/trash-can";
	import CarbonArrowUpRight from "~icons/carbon/arrow-up-right";

	import { useSettingsStore } from "$lib/stores/settings";
	import Switch from "$lib/components/Switch.svelte";

	import { goto } from "$app/navigation";
	import { error } from "$lib/stores/errors";
	import { base } from "$app/paths";
	import { page } from "$app/state";
	import { usePublicConfig } from "$lib/utils/PublicConfig.svelte";
	import { useAPIClient } from "$lib/APIClient";

	const publicConfig = usePublicConfig();
	let settings = useSettingsStore();

	const client = useAPIClient();
</script>

<div class="flex w-full flex-col gap-4">
	<h2 class="text-center text-lg font-semibold text-gray-800 md:text-left">Application Settings</h2>
	{#if !!publicConfig.PUBLIC_COMMIT_SHA}
		<div class="flex flex-col items-start justify-between text-xl font-semibold text-gray-800">
			<a
				href={`https://github.com/huggingface/chat-ui/commit/${publicConfig.PUBLIC_COMMIT_SHA}`}
				target="_blank"
				rel="noreferrer"
				class="text-sm font-light text-gray-500"
			>
				Latest deployment <span class="gap-2 font-mono"
					>{publicConfig.PUBLIC_COMMIT_SHA.slice(0, 7)}</span
				>
			</a>
		</div>
	{/if}
	{#if page.data.isAdmin}
		<p class="rounded-md bg-red-50 px-2 py-1 text-xs font-medium text-red-700">Admin mode</p>
	{/if}
	<div class="flex h-full flex-col gap-4 max-sm:pt-0">
		<div class="rounded-xl border border-gray-200 bg-white px-3 shadow-sm">
			<div class="divide-y divide-gray-200">
				{#if publicConfig.PUBLIC_APP_DATA_SHARING === "1"}
					<div class="flex items-start justify-between py-3">
						<div>
							<div class="text-[13px] font-medium text-gray-800">Share with model authors</div>
							<p class="text-[12px] text-gray-500">
								Sharing your data helps improve open models over time.
							</p>
						</div>
						<Switch
							name="shareConversationsWithModelAuthors"
							bind:checked={$settings.shareConversationsWithModelAuthors}
						/>
					</div>
				{/if}

				<div class="flex items-start justify-between py-3">
					<div>
						<div class="text-[13px] font-medium text-gray-800">Hide emoticons in topics</div>
						<p class="text-[12px] text-gray-500">Hide emojis shown in the conversation list.</p>
					</div>
					<Switch name="hideEmojiOnSidebar" bind:checked={$settings.hideEmojiOnSidebar} />
				</div>

				<div class="flex items-start justify-between py-3">
					<div>
						<div class="text-[13px] font-medium text-gray-800">Disable streaming tokens</div>
						<p class="text-[12px] text-gray-500">Show responses only when complete.</p>
					</div>
					<Switch name="disableStream" bind:checked={$settings.disableStream} />
				</div>

				<div class="flex items-start justify-between py-3">
					<div>
						<div class="text-[13px] font-medium text-gray-800">Paste text directly</div>
						<p class="text-[12px] text-gray-500">
							Paste long text directly into chat instead of a file.
						</p>
					</div>
					<Switch name="directPaste" bind:checked={$settings.directPaste} />
				</div>
			</div>
		</div>

		<div class="mt-6 flex flex-col gap-2 text-[13px]">
			<a
				href="https://huggingface.co/spaces/huggingchat/chat-ui/discussions"
				target="_blank"
				rel="noreferrer"
				class="flex items-center underline decoration-gray-300 underline-offset-2 hover:decoration-gray-700"
				><CarbonArrowUpRight class="mr-1.5 shrink-0 text-sm " /> Share your feedback on HuggingChat</a
			>
			{#if publicConfig.isHuggingChat}
				<a
					href="{base}/privacy"
					class="flex items-center underline decoration-gray-300 underline-offset-2 hover:decoration-gray-700"
					><CarbonArrowUpRight class="mr-1.5 shrink-0 text-sm " /> About & Privacy</a
				>
			{/if}
			<button
				onclick={async (e) => {
					e.preventDefault();

					confirm("Are you sure you want to delete all conversations?") &&
						client.conversations
							.delete()
							.then(async () => {
								await goto(`${base}/`, { invalidateAll: true });
							})
							.catch((err) => {
								console.error(err);
								$error = err.message;
							});
				}}
				type="submit"
				class="flex items-center underline decoration-red-200 underline-offset-2 hover:decoration-red-500"
				><CarbonTrashCan class="mr-2 inline text-sm text-red-500" />Delete all conversations</button
			>
		</div>
	</div>
</div>
