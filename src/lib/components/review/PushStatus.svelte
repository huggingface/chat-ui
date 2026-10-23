<script lang="ts">
	import type { ReviewPushState } from "$lib/stores/mlReview.svelte";
	import type { PublishAudience, ReviewDestination, ReviewPublish } from "$lib/types/MlReview";

	import CarbonCloudUpload from "~icons/carbon/cloud-upload";
	import CarbonLaunch from "~icons/carbon/launch";
	import CarbonWarning from "~icons/carbon/warning-alt";

	interface Props {
		destination?: ReviewDestination;
		/** who would see the labels, resolved by the server when the review was asked for */
		audience?: PublishAudience;
		publish?: ReviewPublish;
		push?: ReviewPushState;
		/** what the resolved update carried, for a card whose review is not loaded */
		pushed?: { url: string; pr: boolean };
		/** the failure the resolved update carried, for the same card */
		failed?: { error: string; where: string };
		/** the destination the user chose not to push to */
		declined?: ReviewDestination;
		/** before the submit, where the labels could go */
		planned?: boolean;
		/** the push stayed running past the polling budget, its replica likely died */
		stale?: boolean;
		/** sent after the turn moved on, its publish card waits for the running reply to end */
		detached?: boolean;
	}

	let {
		destination,
		audience,
		publish,
		push,
		pushed,
		failed,
		declined,
		planned = false,
		stale = false,
		detached = false,
	}: Props = $props();

	let where = $derived(
		destination ? `${destination.repo}/${push?.path ?? destination.path}` : undefined
	);
	let link = $derived(push?.status === "pushed" ? push.url : pushed?.url);
	let pr = $derived(push?.pr ?? pushed?.pr ?? destination?.pr ?? false);
	let label = $derived(publish?.audience?.label ?? audience?.label);
	let asking = $derived(!!publish?.promptId && !publish.decision);
	/** a detached review's card is put on its message once the running reply ends */
	let waiting = $derived(asking && !!detached && !publish?.attached);
</script>

{#if link}
	<span
		class="flex min-w-0 items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400"
		data-push="pushed"
	>
		<CarbonCloudUpload class="flex-none text-green-700 dark:text-green-400" />
		<span class="flex-none">Labels pushed to</span>
		<a
			href={link}
			target="_blank"
			rel="noreferrer"
			class="inline-flex min-w-0 items-center gap-1 font-medium text-gray-900 underline decoration-gray-300 underline-offset-2 hover:decoration-gray-500 dark:text-gray-100 dark:decoration-gray-600"
		>
			<span class="truncate">{where ?? link}</span>
			<CarbonLaunch class="flex-none text-[11px]" />
		</a>
		{#if pr}<span class="flex-none">as a pull request</span>{/if}
	</span>
{:else if (destination && push?.status === "failed") || (!push && failed)}
	{@const error = push?.error ?? failed?.error}
	<span class="flex items-start gap-1.5 text-xs text-red-600 dark:text-red-400" data-push="failed">
		<CarbonWarning class="mt-px flex-none" />
		<span>Couldn't push labels to {where ?? failed?.where}{error ? `: ${error}` : ""}</span>
	</span>
{:else if declined}
	<span
		class="flex min-w-0 items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400"
		data-push="declined"
	>
		<CarbonCloudUpload class="flex-none" />
		<span class="min-w-0 truncate">
			Labels not pushed to {declined.repo}/{declined.path}{publish?.reason
				? `, ${publish.reason}`
				: ""}
		</span>
	</span>
{:else if destination}
	<span
		class="flex min-w-0 items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400"
		data-push={planned
			? "planned"
			: waiting
				? "card-waiting"
				: asking
					? "asking"
					: (push?.status ?? "waiting")}
	>
		<CarbonCloudUpload class="flex-none" />
		<span class="min-w-0 truncate">
			{#if planned}
				After sending you choose whether to push labels to <b
					class="font-medium text-gray-700 dark:text-gray-300">{label ?? destination.repo}</b
				>
				· {destination.path}
			{:else if waiting}
				The question about pushing labels to {label ?? where} appears in the chat when the current reply
				ends
			{:else if asking}
				Answer the question in the chat to push labels to {label ?? where}
			{:else if push?.status === "pushing" && stale}
				Couldn't confirm the push to {where}. Check the repo, or reload the review later.
			{:else if push?.status === "pushing"}
				Pushing labels to {where}…
			{:else}
				Labels go to {where}{pr ? " as a pull request" : ""} when the agent picks this up
			{/if}
		</span>
	</span>
{/if}
