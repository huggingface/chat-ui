<script lang="ts">
	import { onMount } from "svelte";
	import { base } from "$app/paths";
	import { page } from "$app/state";
	import CarbonTrashCan from "~icons/carbon/trash-can";
	import CarbonAdd from "~icons/carbon/add";
	import CarbonClose from "~icons/carbon/close";
	import CarbonArrowUpRight from "~icons/carbon/arrow-up-right";
	import { useAPIClient, handleResponse } from "$lib/APIClient";
	import { usePublicConfig } from "$lib/utils/PublicConfig.svelte";
	import { ML_ASSISTANT_MODE } from "$lib/utils/mlAssistantFlag";
	import type { MlAutomationDeliveryStatus, MlWatchedItem } from "$lib/types/MlAutomation";

	type Delivery = {
		receivedAt: Date;
		status: MlAutomationDeliveryStatus;
		reason?: string;
		conversationId?: { toString(): string };
		event: { action: string; scope: string; repo: string };
	};
	type Automation = {
		_id: { toString(): string };
		name: string;
		instruction: string;
		watched: MlWatchedItem[];
		webhookId?: string;
		budgetUsd: number;
		maxRunsPerDay: number;
		billTo?: { organization: string; resourceGroup?: string };
		enabled: boolean;
		disabledReason?: string;
		recentDeliveries: Delivery[];
	};
	type BillingOrg = {
		name: string;
		preferred_username: string;
		resourceGroups: { sub: string; name: string }[];
	};

	const client = useAPIClient();
	const publicConfig = usePublicConfig();
	const WATCH_TYPES: MlWatchedItem["type"][] = ["model", "dataset", "space", "user", "org"];

	let automations = $state<Automation[]>([]);
	let loading = $state(true);
	let loadError = $state<string | undefined>();
	let billingOrgs = $state<BillingOrg[]>([]);
	let busyId = $state<string | undefined>();

	let formOpen = $state(false);
	let saving = $state(false);
	let formError = $state<string | undefined>();
	let manual = $state<{ url: string; secret: string } | undefined>();
	let form = $state(blankForm());

	function blankForm() {
		return {
			name: "",
			instruction: "",
			watched: [{ type: "model" as MlWatchedItem["type"], name: "" }],
			budgetUsd: 5,
			maxRunsPerDay: 10,
			billing: "",
			token: "",
		};
	}

	function errorMessage(err: unknown, fallback: string): string {
		try {
			const body = JSON.parse((err as Error).message) as { message?: string };
			return body.message ?? fallback;
		} catch {
			return fallback;
		}
	}

	async function load() {
		try {
			automations = (await client["ml-automations"].get().then(handleResponse)) ?? [];
			loadError = undefined;
		} catch (err) {
			loadError = errorMessage(err, "Could not load your automations.");
		} finally {
			loading = false;
		}
	}

	onMount(async () => {
		await load();
		if (publicConfig.isHuggingChat) {
			try {
				const data = await client.user["billing-orgs"].get().then(handleResponse);
				billingOrgs = data?.organizations ?? [];
			} catch {
				billingOrgs = [];
			}
		}
	});

	function billTo(value: string) {
		if (value.startsWith("organization:"))
			return { organization: value.slice("organization:".length) };
		if (value.startsWith("resource-group:")) {
			const sub = value.slice("resource-group:".length);
			const org = billingOrgs.find((o) => o.resourceGroups.some((g) => g.sub === sub));
			return org ? { organization: org.preferred_username, resourceGroup: sub } : undefined;
		}
		return undefined;
	}

	function billToLabel(target: Automation["billTo"]) {
		if (!target) return "Personal account";
		const org = billingOrgs.find((o) => o.preferred_username === target.organization);
		const group = org?.resourceGroups.find((g) => g.sub === target.resourceGroup);
		return group ? `${org?.name} / ${group.name}` : (org?.name ?? target.organization);
	}

	async function create(event: SubmitEvent) {
		event.preventDefault();
		saving = true;
		formError = undefined;
		try {
			const target = billTo(form.billing);
			const created = await client["ml-automations"]
				.post({
					name: form.name,
					instruction: form.instruction,
					watched: form.watched
						.map((item) => ({ type: item.type, name: item.name.trim() }))
						.filter((item) => item.name),
					budgetUsd: Number(form.budgetUsd),
					maxRunsPerDay: Number(form.maxRunsPerDay),
					...(target ? { billTo: target } : {}),
					token: form.token,
				})
				.then(handleResponse);
			manual = created?.manual;
			form = blankForm();
			formOpen = false;
			await load();
		} catch (err) {
			formError = errorMessage(err, "Could not add this automation.");
		} finally {
			saving = false;
		}
	}

	async function setEnabled(automation: Automation, enabled: boolean) {
		const id = automation._id.toString();
		busyId = id;
		try {
			await client["ml-automations"]({ id }).patch({ enabled }).then(handleResponse);
			await load();
		} finally {
			busyId = undefined;
		}
	}

	async function remove(automation: Automation) {
		if (!confirm(`Delete "${automation.name}"? Runs it already started stop at their next step.`))
			return;
		const id = automation._id.toString();
		busyId = id;
		try {
			await client["ml-automations"]({ id }).delete().then(handleResponse);
			await load();
		} finally {
			busyId = undefined;
		}
	}

	const watchLabel = (item: MlWatchedItem) =>
		item.type === "user" || item.type === "org" ? `${item.type} ${item.name}` : item.name;

	const statusClass: Record<MlAutomationDeliveryStatus, string> = {
		started: "text-green-700 dark:text-green-400",
		skipped: "text-gray-500 dark:text-gray-400",
		failed: "text-red-600 dark:text-red-400",
	};

	const inputClass =
		"w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-800 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200";
	const labelClass = "text-[13px] font-medium text-gray-800 dark:text-gray-200";
	const hintClass = "text-[12px] text-gray-500 dark:text-gray-400";
</script>

<div class="flex w-full flex-col gap-4">
	<h2 class="text-center text-lg font-semibold text-gray-800 md:text-left dark:text-gray-200">
		ML Intern automations
	</h2>

	{#if !ML_ASSISTANT_MODE || !page.data.user}
		<p class={hintClass}>Sign in to ML Intern to set up automations.</p>
	{:else}
		<p class={hintClass}>
			An automation starts an ML Intern run whenever something changes in a repo you watch. It runs
			on its own with your token and never stops to ask, so give it a clear instruction and a budget
			it can't go over.
		</p>

		{#if manual}
			<div
				class="rounded-xl border border-amber-300 bg-amber-50 p-3 text-[13px] text-amber-900 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-200"
			>
				<div class="flex items-start justify-between gap-2">
					<p class="font-medium">Add the webhook on the Hub yourself</p>
					<button
						type="button"
						aria-label="Dismiss"
						class="rounded p-0.5 hover:bg-amber-100 dark:hover:bg-amber-800/40"
						onclick={() => (manual = undefined)}><CarbonClose class="size-3.5" /></button
					>
				</div>
				<p class="mt-1">
					The Hub can't reach this server, so the webhook wasn't created for you. In
					<a
						class="underline"
						href="https://huggingface.co/settings/webhooks"
						target="_blank"
						rel="noreferrer">your webhook settings</a
					>, add one with this URL and secret. The secret is shown only once.
				</p>
				<dl class="mt-2 grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 font-mono text-[12px]">
					<dt>URL</dt>
					<dd class="break-all select-all">{manual.url}</dd>
					<dt>Secret</dt>
					<dd class="break-all select-all">{manual.secret}</dd>
				</dl>
			</div>
		{/if}

		{#if loading}
			<p class={hintClass}>Loading...</p>
		{:else if loadError}
			<p class="text-[13px] text-red-600 dark:text-red-400">{loadError}</p>
		{:else}
			{#each automations as automation (automation._id.toString())}
				{@const id = automation._id.toString()}
				<div
					class="rounded-xl border border-gray-200 bg-white p-3 shadow-xs dark:border-gray-700 dark:bg-gray-800"
				>
					<div class="flex items-start justify-between gap-3">
						<div class="min-w-0">
							<div class="flex items-center gap-2">
								<span class={labelClass}>{automation.name}</span>
								{#if !automation.enabled}
									<span
										class="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-600 dark:bg-gray-700 dark:text-gray-300"
										>Off</span
									>
								{/if}
							</div>
							<p class={hintClass}>
								Watches {automation.watched.map(watchLabel).join(", ")} · ${automation.budgetUsd} per
								run · up to {automation.maxRunsPerDay} runs a day · bills {billToLabel(
									automation.billTo
								)}
							</p>
						</div>
						<div class="flex flex-none items-center gap-1">
							<button
								type="button"
								class="rounded-md border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50 disabled:opacity-60 dark:border-gray-600 dark:hover:bg-gray-700"
								disabled={busyId === id}
								onclick={() => setEnabled(automation, !automation.enabled)}
								>{automation.enabled ? "Turn off" : "Turn on"}</button
							>
							<button
								type="button"
								aria-label="Delete {automation.name}"
								class="rounded-md p-1.5 text-gray-500 hover:bg-gray-100 hover:text-red-600 disabled:opacity-60 dark:hover:bg-gray-700"
								disabled={busyId === id}
								onclick={() => remove(automation)}><CarbonTrashCan class="size-3.5" /></button
							>
						</div>
					</div>
					<p
						class="mt-2 line-clamp-3 text-[12px] whitespace-pre-wrap text-gray-700 dark:text-gray-300"
					>
						{automation.instruction}
					</p>
					{#if automation.disabledReason}
						<p class="mt-2 text-[12px] text-red-600 dark:text-red-400">
							{automation.disabledReason}
						</p>
					{/if}
					{#if automation.recentDeliveries.length > 0}
						<ul class="mt-2 divide-y divide-gray-100 text-[12px] dark:divide-gray-700">
							{#each automation.recentDeliveries as delivery}
								<li class="flex items-center justify-between gap-2 py-1">
									<span class="min-w-0 truncate text-gray-600 dark:text-gray-300">
										{new Date(delivery.receivedAt).toLocaleString()} · {delivery.event.repo} · {delivery
											.event.scope}
									</span>
									<span class="flex flex-none items-center gap-1 {statusClass[delivery.status]}">
										{#if delivery.conversationId}
											<a
												class="inline-flex items-center gap-0.5 underline"
												href="{base}/conversation/{delivery.conversationId.toString()}"
												>{delivery.status}<CarbonArrowUpRight class="size-3" /></a
											>
										{:else}
											<span title={delivery.reason}>{delivery.status}</span>
										{/if}
									</span>
								</li>
							{/each}
						</ul>
					{:else if automation.enabled}
						<p class="mt-2 {hintClass}">No events yet.</p>
					{/if}
				</div>
			{/each}

			{#if formOpen}
				<form
					class="flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-3 shadow-xs dark:border-gray-700 dark:bg-gray-800"
					onsubmit={create}
				>
					<label class="flex flex-col gap-1">
						<span class={labelClass}>Name</span>
						<input class={inputClass} bind:value={form.name} required maxlength="100" />
					</label>

					<div class="flex flex-col gap-1">
						<span class={labelClass}>Watch</span>
						<span class={hintClass}
							>A run starts when one of these repos, or any repo of this user or org, changes.</span
						>
						{#each form.watched as item, i}
							<div class="flex gap-2">
								<select
									class="rounded-md border border-gray-300 bg-white px-1 py-1 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200"
									bind:value={item.type}
									aria-label="What to watch"
								>
									{#each WATCH_TYPES as type}
										<option value={type}>{type}</option>
									{/each}
								</select>
								<input
									class={inputClass}
									bind:value={item.name}
									placeholder={item.type === "user" || item.type === "org" ? "name" : "owner/repo"}
									aria-label="Name to watch"
									required
								/>
								{#if form.watched.length > 1}
									<button
										type="button"
										aria-label="Remove"
										class="rounded-md p-1.5 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"
										onclick={() => form.watched.splice(i, 1)}
										><CarbonClose class="size-3.5" /></button
									>
								{/if}
							</div>
						{/each}
						{#if form.watched.length < 10}
							<button
								type="button"
								class="self-start text-[12px] text-gray-600 underline dark:text-gray-300"
								onclick={() => form.watched.push({ type: "model", name: "" })}>Add another</button
							>
						{/if}
					</div>

					<label class="flex flex-col gap-1">
						<span class={labelClass}>Instruction</span>
						<span class={hintClass}
							>What to do with each event. The event's details are added after it.</span
						>
						<textarea
							class="{inputClass} min-h-24"
							bind:value={form.instruction}
							required
							maxlength="4000"
							placeholder="Run eval.py against the new revision and open a discussion with the scores."
						></textarea>
					</label>

					<div class="grid grid-cols-2 gap-3">
						<label class="flex flex-col gap-1">
							<span class={labelClass}>Budget per run (USD)</span>
							<input
								class={inputClass}
								type="number"
								min="0.01"
								max="1000"
								step="0.01"
								bind:value={form.budgetUsd}
								required
							/>
						</label>
						<label class="flex flex-col gap-1">
							<span class={labelClass}>Runs per day</span>
							<input
								class={inputClass}
								type="number"
								min="1"
								max="100"
								step="1"
								bind:value={form.maxRunsPerDay}
								required
							/>
						</label>
					</div>

					{#if publicConfig.isHuggingChat}
						<label class="flex flex-col gap-1">
							<span class={labelClass}>Bill to</span>
							<select class={inputClass} bind:value={form.billing}>
								<option value="">Personal account</option>
								{#each billingOrgs as org}
									<option value={`organization:${org.preferred_username}`}>{org.name}</option>
									{#each org.resourceGroups as group}
										<option value={`resource-group:${group.sub}`}>{org.name} / {group.name}</option>
									{/each}
								{/each}
							</select>
						</label>
					{/if}

					<label class="flex flex-col gap-1">
						<span class={labelClass}>Access token</span>
						<span class={hintClass}>
							Runs act as this token. Create one in
							<a
								class="underline"
								href="https://huggingface.co/settings/tokens"
								target="_blank"
								rel="noreferrer">your token settings</a
							>
							that can manage webhooks, read what it watches, and do what the instruction needs.
						</span>
						<input
							class={inputClass}
							type="password"
							autocomplete="off"
							bind:value={form.token}
							required
							placeholder="hf_..."
						/>
					</label>

					{#if formError}
						<p class="text-[13px] text-red-600 dark:text-red-400">{formError}</p>
					{/if}
					<div class="flex justify-end gap-2">
						<button
							type="button"
							class="rounded-md px-3 py-1.5 text-sm hover:bg-gray-100 dark:hover:bg-gray-700"
							onclick={() => {
								formOpen = false;
								formError = undefined;
							}}>Cancel</button
						>
						<button
							type="submit"
							class="rounded-md bg-black px-3 py-1.5 text-sm text-white disabled:opacity-60 dark:bg-white dark:text-black"
							disabled={saving}>{saving ? "Adding..." : "Add automation"}</button
						>
					</div>
				</form>
			{:else}
				<button
					type="button"
					class="flex items-center gap-1 self-start rounded-md border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-700"
					onclick={() => (formOpen = true)}><CarbonAdd class="size-4" />New automation</button
				>
			{/if}
		{/if}
	{/if}
</div>
