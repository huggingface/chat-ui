<script lang="ts">
	import CarbonTrashCan from "~icons/carbon/trash-can";
	import CarbonArrowUpRight from "~icons/carbon/arrow-up-right";

	import { useSettingsStore } from "$lib/stores/settings";
	import { useTranslations, LANGUAGES, detectBrowserLanguage } from "$lib/stores/translations";
	import Switch from "$lib/components/Switch.svelte";
	import { env as envPublic } from "$env/dynamic/public";
	import { goto } from "$app/navigation";
	import { error } from "$lib/stores/errors";
	import { base } from "$app/paths";

	let settings = useSettingsStore();
	const translations = useTranslations();

	const detectedBrowserLanguage = detectBrowserLanguage();
	const detectedBrowserLanguageName = detectedBrowserLanguage
		? LANGUAGES[detectedBrowserLanguage]
		: null;

	$: if ($settings.language === "browser" && !detectedBrowserLanguageName) {
		$settings.language = "en";
	}
</script>

<div class="flex w-full flex-col gap-5">
	<h2 class="text-center text-xl font-semibold text-gray-800 md:text-left">
		{$translations.t("application_settings")}
	</h2>
	{#if !!envPublic.PUBLIC_COMMIT_SHA}
		<div class="flex flex-col items-start justify-between text-xl font-semibold text-gray-800">
			<a
				href={`https://github.com/huggingface/chat-ui/commit/${envPublic.PUBLIC_COMMIT_SHA}`}
				target="_blank"
				rel="noreferrer"
				class="text-sm font-light text-gray-500"
			>
				{$translations.t("latest_deployment")}
				<span class="gap-2 font-mono">{envPublic.PUBLIC_COMMIT_SHA.slice(0, 7)}</span>
			</a>
		</div>
	{/if}
	<div class="flex h-full max-w-2xl flex-col gap-2 max-sm:pt-0">
		<!-- Language selection dropdown -->
		<div class="mb-6 mt-6">
			<div class="font-semibold">{$translations.t("language_selection")}</div>
			<p class="mb-2 text-sm text-gray-500">
				{$translations.t("language_description")}
			</p>
			<select
				class="w-full max-w-xs rounded-md border border-gray-300 p-2"
				bind:value={$settings.language}
			>
				{#if detectedBrowserLanguageName}
					<option value="browser"
						>{$translations.t("browser_default")} ({detectedBrowserLanguageName})</option
					>
				{/if}
				{#each Object.entries(LANGUAGES) as [code, name]}
					<option value={code}>{name}</option>
				{/each}
			</select>
		</div>

		{#if envPublic.PUBLIC_APP_DATA_SHARING === "1"}
			<label class="flex items-center">
				<Switch
					name="shareConversationsWithModelAuthors"
					bind:checked={$settings.shareConversationsWithModelAuthors}
				/>
				<div class="inline cursor-pointer select-none items-center gap-2 pl-2">
					{$translations.t("share_conversations")}
				</div>
			</label>

			<p class="text-sm text-gray-500">
				{$translations.t("sharing_data_help")}
			</p>
		{/if}
		<label class="mt-6 flex items-center">
			<Switch name="hideEmojiOnSidebar" bind:checked={$settings.hideEmojiOnSidebar} />
			<div class="inline cursor-pointer select-none items-center gap-2 pl-2 font-semibold">
				{$translations.t("hide_emoticons")}
				<p class="text-sm font-normal text-gray-500">
					{$translations.t("emoticons_shown")}
				</p>
			</div>
		</label>

		<label class="mt-6 flex items-center">
			<Switch name="disableStream" bind:checked={$settings.disableStream} />
			<div class="inline cursor-pointer select-none items-center gap-2 pl-2 font-semibold">
				{$translations.t("disable_streaming")}
			</div>
		</label>

		<label class="mt-6 flex items-center">
			<Switch name="directPaste" bind:checked={$settings.directPaste} />
			<div class="inline cursor-pointer select-none items-center gap-2 pl-2 font-semibold">
				{$translations.t("paste_text")}
				<p class="text-sm font-normal text-gray-500">
					{$translations.t("paste_text_description")}
				</p>
			</div>
		</label>

		<div class="mt-12 flex flex-col gap-3">
			<a
				href="https://huggingface.co/spaces/huggingchat/chat-ui/discussions"
				target="_blank"
				rel="noreferrer"
				class="flex items-center underline decoration-gray-300 underline-offset-2 hover:decoration-gray-700"
				><CarbonArrowUpRight class="mr-1.5 shrink-0 text-sm " />
				{$translations.t("share_feedback")}</a
			>
			<button
				onclick={async (e) => {
					e.preventDefault();

					confirm($translations.t("confirm_delete")) &&
						(await fetch(`${base}/api/conversations`, {
							method: "DELETE",
						})
							.then(async () => {
								await goto(`${base}/`, { invalidateAll: true });
							})
							.catch((err) => {
								console.error(err);
								$error = err.message;
							}));
				}}
				type="submit"
				class="flex items-center underline decoration-gray-300 underline-offset-2 hover:decoration-gray-700"
				><CarbonTrashCan class="mr-2 inline text-sm text-red-500" />{$translations.t(
					"delete_conversations"
				)}</button
			>
		</div>
	</div>
</div>
