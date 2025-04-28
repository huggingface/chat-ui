<script lang="ts">
	import { invalidateAll } from "$app/navigation";
	import Modal from "$lib/components/Modal.svelte";
	import { createEventDispatcher } from "svelte";
	import { useTranslations } from "$lib/stores/translations";

	const dispatch = createEventDispatcher<{ close: void }>();

	let reason = $state("");

	interface Props {
		reportUrl: string;
	}

	let { reportUrl }: Props = $props();

	const translations = useTranslations();
</script>

<Modal on:close>
	<form
		onsubmit={() => {
			fetch(`${reportUrl}`, {
				method: "POST",
				body: JSON.stringify({ reason }),
			}).then(() => {
				dispatch("close");
				invalidateAll();
			});
		}}
		class="w-full min-w-64 p-4"
	>
		<span class="mb-1 text-sm font-semibold">{$translations.t("report_content")}</span>

		<p class="text-sm text-gray-500">
			{$translations.t("report_description")}
		</p>

		<textarea
			name="reportReason"
			class="mt-6 max-h-48 w-full resize-y rounded-lg border-2 border-gray-200 bg-gray-100 p-2 text-smd"
			placeholder={$translations.t("report_reason_placeholder")}
			maxlength="128"
			bind:value={reason}
		></textarea>

		<div class="flex w-full flex-row justify-between px-2 pt-4">
			<button
				type="button"
				class="text-sm text-gray-700 hover:underline"
				onclick={() => dispatch("close")}>{$translations.t("cancel")}</button
			>

			<button
				type="submit"
				class="rounded-full bg-black px-4 py-2 text-sm font-semibold text-white md:px-8"
				disabled={!reason}
				class:bg-gray-200={!reason}
				class:!text-gray-400={!reason}
			>
				{$translations.t("submit_report")}
			</button>
		</div>
	</form>
</Modal>
