<script lang="ts">
	import { afterNavigate, goto, invalidateAll } from "$app/navigation";
	import { base } from "$app/paths";
	import { page } from "$app/state";
	import Modal from "$lib/components/Modal.svelte";
	import ToolLogo from "$lib/components/ToolLogo.svelte";

	import { useSettingsStore } from "$lib/stores/settings";
	import { ReviewStatus } from "$lib/types/Review";

	import ReportModal from "../../settings/(nav)/assistants/[assistantId]/ReportModal.svelte";
	import { enhance } from "$app/forms";
	import CopyToClipBoardBtn from "$lib/components/CopyToClipBoardBtn.svelte";

	import CarbonPen from "~icons/carbon/pen";
	import CarbonTrash from "~icons/carbon/trash-can";
	import CarbonCopy from "~icons/carbon/copy-file";
	import CarbonFlag from "~icons/carbon/flag";
	import CarbonLink from "~icons/carbon/link";
	import CarbonStar from "~icons/carbon/star";
	import CarbonLock from "~icons/carbon/locked";
	import { error } from "$lib/stores/errors";
	import { usePublicConfig } from "$lib/utils/PublicConfig.svelte";

	const publicConfig = usePublicConfig();

	let { data } = $props();

	const settings = useSettingsStore();

	let previousPage: string = $state(base || "/");

	afterNavigate(({ from }) => {
		if (from?.url && !from.url.pathname.includes("tools/")) {
			previousPage = from.url.toString() || previousPage || base || "/";
		}
	});

	const prefix =
		publicConfig.PUBLIC_SHARE_PREFIX || `${publicConfig.PUBLIC_ORIGIN || page.url.origin}${base}`;

	let shareUrl = $derived(`${prefix}/tools/${data.tool?._id}`);
	let isActive = $derived($settings.tools?.includes(data.tool?._id.toString()));

	let displayReportModal = $state(false);

	let currentModelSupportTools = $derived(
		data.models.find((m) => m.id === $settings.activeModel)?.tools ?? false
	);

	function setFeatured(status: ReviewStatus) {
		fetch(`${base}/api/tools/${data.tool?._id}/review`, {
			method: "PATCH",
			body: JSON.stringify({ status }),
		}).then((r) => {
			if (r.ok) {
				invalidateAll();
			} else {
				console.error(r);
				$error = r.statusText;
			}
		});
	}
</script>

{#if displayReportModal}
	<ReportModal
		on:close={() => (displayReportModal = false)}
		reportUrl={`${base}/api/tools/${data.tool?._id}/report`}
	/>
{/if}

<Modal on:close={() => goto(previousPage)} width="min-w-xl" closeButton>
	<div class="w-full min-w-64 p-8">
		<div class="flex h-full flex-col gap-2">
			<div class="flex flex-col sm:flex-row sm:gap-6">
				<div class="mb-4 flex justify-center sm:mb-0">
					{#key data.tool.color + data.tool.icon}
						<ToolLogo color={data.tool.color} icon={data.tool.icon} size="lg" />
					{/key}
				</div>

				<div class="flex-1">
					<div class="flex flex-wrap items-center gap-2">
						<h1 class="break-words text-xl font-semibold">
							{data.tool.displayName}
						</h1>
						<span class="inline rounded-full border px-2 py-0.5 text-sm leading-none text-gray-500"
							>public</span
						>
					</div>

					{#if data.tool?.baseUrl}
						{#if data.tool.baseUrl.startsWith("https://")}
							<p class="mb-2 break-words font-mono text-gray-500">
								{data.tool.baseUrl}
							</p>
						{:else}
							<a
								href="https://huggingface.co/spaces/{data.tool.baseUrl}"
								target="_blank"
								class="mb-2 break-words font-mono text-gray-500 hover:underline"
							>
								{data.tool.baseUrl}
							</a>
						{/if}
					{/if}

					{#if data.tool.type === "community"}
						<p class="text-sm text-gray-500">
							Added by
							<a class="underline" href="{base}/tools?user={data.tool?.createdByName}">
								{data.tool?.createdByName}
							</a>
							<span class="text-gray-300">•</span>
							{#if data.tool.useCount === 1}
								1 run
							{:else}
								{data.tool.useCount} runs
							{/if}
						</p>
					{/if}

					<div
						class="flex flex-wrap items-center gap-x-4 gap-y-2 whitespace-nowrap text-sm text-gray-500 hover:*:text-gray-800 max-sm:justify-center"
					>
						<div class="w-full sm:w-auto">
							{#if currentModelSupportTools}
								<button
									class="{isActive
										? 'bg-gray-100 text-gray-800'
										: 'bg-black !text-white'} mx-auto my-2 flex w-min items-center justify-center rounded-full px-3 py-1 text-base"
									name="Activate model"
									onclick={(e) => {
										e.stopPropagation();
										if (isActive) {
											settings.instantSet({
												tools: ($settings?.tools ?? []).filter((t) => t !== data.tool._id),
											});
										} else {
											settings.instantSet({
												tools: [...($settings?.tools ?? []), data.tool._id],
											});
										}
									}}
								>
									{isActive ? "Deactivate" : "Activate"}
								</button>
							{:else}
								<button
									disabled
									class="mx-auto my-2 flex w-min items-center justify-center rounded-full bg-gray-200 px-3 py-1 text-base text-gray-500"
								>
									Activate
								</button>
							{/if}
						</div>
						{#if data.tool?.createdByMe}
							<a href="{base}/tools/{data.tool?._id}/edit" class="underline"
								><CarbonPen class="mr-1.5 inline text-xs" />Edit
							</a>
							<form
								onsubmit={() => {
									fetch(`${base}/api/tools/${data.tool?._id}`, {
										method: "DELETE",
									}).then((r) => {
										if (r.ok) {
											goto(`${base}/tools`, { invalidateAll: true });
										} else {
											console.error(r);
											$error = r.statusText;
										}
									});
								}}
							>
								<button
									type="submit"
									class="flex items-center underline"
									onclick={(event) => {
										if (!confirm("Are you sure you want to delete this tool?")) {
											event.preventDefault();
										}
									}}
								>
									<CarbonTrash class="mr-1.5 inline text-xs" />Delete
								</button>
							</form>
						{:else if !!data.tool?.baseUrl}
							<a href="{base}/tools/{data.tool?._id}/edit" class="underline">
								<CarbonPen class="mr-1.5 inline text-xs" />View spec
							</a>
							<form method="POST" action="?/edit" use:enhance class="hidden">
								<button type="submit" class="underline">
									<CarbonCopy class="mr-1.5 inline text-xs" />Duplicate</button
								>
							</form>
							{#if !data.tool?.reported}
								<button
									type="button"
									onclick={() => {
										displayReportModal = true;
									}}
									class="underline"
								>
									<CarbonFlag class="mr-1.5 inline text-xs" />Report
								</button>
							{:else}
								<button type="button" disabled class="text-gray-700">
									<CarbonFlag class="mr-1.5 inline text-xs" />Reported</button
								>
							{/if}
						{/if}
						{#if data?.isAdmin}
							<span class="rounded-full border px-2 py-0.5 text-sm leading-none text-gray-500"
								>{data.tool?.review?.toLocaleUpperCase()}</span
							>

							{#if !data.tool?.createdByMe}
								<form
									onsubmit={() => {
										fetch(`${base}/api/tools/${data.tool?._id}`, {
											method: "DELETE",
										}).then((r) => {
											if (r.ok) {
												goto(`${base}/tools`, { invalidateAll: true });
											} else {
												console.error(r);
												$error = r.statusText;
											}
										});
									}}
								>
									<button
										type="submit"
										class="flex items-center text-red-600 underline"
										onclick={(event) => {
											if (!confirm("Are you sure you want to delete this tool?")) {
												event.preventDefault();
											}
										}}
									>
										<CarbonTrash class="mr-1.5 inline text-xs" />Delete
									</button>
								</form>
							{/if}
							{#if data.tool?.review === ReviewStatus.PRIVATE}
								<form onsubmit={() => setFeatured(ReviewStatus.APPROVED)}>
									<button type="submit" class="flex items-center text-green-600 underline">
										<CarbonStar class="mr-1.5 inline text-xs" />Force feature</button
									>
								</form>
							{/if}
							{#if data.tool?.review === ReviewStatus.PENDING}
								<form onsubmit={() => setFeatured(ReviewStatus.APPROVED)}>
									<button type="submit" class="flex items-center text-green-600 underline">
										<CarbonStar class="mr-1.5 inline text-xs" />Approve</button
									>
								</form>
								<form onsubmit={() => setFeatured(ReviewStatus.DENIED)}>
									<button type="submit" class="flex items-center text-red-600">
										<span class="mr-1.5 font-light no-underline">X</span>
										<span class="underline">Deny</span>
									</button>
								</form>
							{/if}
							{#if data.tool?.review === ReviewStatus.APPROVED || data.tool?.review === ReviewStatus.DENIED}
								<form onsubmit={() => setFeatured(ReviewStatus.PRIVATE)}>
									<button type="submit" class="flex items-center text-red-600 underline">
										<CarbonLock class="mr-1.5 inline text-xs " />Reset review</button
									>
								</form>
							{/if}
						{/if}
						{#if data.tool?.createdByMe && data.tool?.review === ReviewStatus.PRIVATE}
							<form
								onsubmit={() => {
									const confirmed = confirm(
										"Are you sure you want to request this tool to be featured? Make sure you have tried the tool and that it works as expected. We will review your request once submitted."
									);

									if (!confirmed) {
										return;
									}

									setFeatured(ReviewStatus.PENDING);
								}}
							>
								<button type="submit" class="flex items-center underline">
									<CarbonStar class="mr-1.5 inline text-xs" />Request to be featured</button
								>
							</form>
						{/if}
					</div>
				</div>
			</div>
			{#if !currentModelSupportTools}
				<span class="relative text-sm text-gray-500">
					You are currently not using a model that supports tools. Activate one
					<a href="{base}/models" class="underline">here</a>.
				</span>
			{:else}
				<p class="text-sm max-sm:hidden">
					Tools are applications that the model can choose to call while you are chatting with it.
				</p>
			{/if}
			{#if data.tool.description}
				<div>
					<h2 class="text-lg font-semibold">Description</h2>
					<p class="pb-2">{data.tool.description}</p>
				</div>
			{/if}

			<div>
				<h2 class="text-lg font-semibold">Direct URL</h2>

				<p class="pb-2 text-sm text-gray-500">Share this link with people to use your tool.</p>
				<div
					class="flex flex-row items-center gap-2 rounded-lg border-2 border-gray-200 bg-gray-100 py-2 pl-3 pr-1.5"
				>
					<div class="relative flex-1 overflow-hidden">
						<input disabled class="w-full truncate bg-inherit pr-16" value={shareUrl} />
						<div class="absolute right-0 top-1/2 -translate-y-1/2">
							<CopyToClipBoardBtn
								value={shareUrl}
								classNames="!border-none !shadow-none !py-0 !px-1 !rounded-md"
							>
								<div class="flex items-center gap-1.5 text-gray-500 hover:underline">
									<CarbonLink />Copy
								</div>
							</CopyToClipBoardBtn>
						</div>
					</div>
				</div>
			</div>
		</div>
	</div></Modal
>
