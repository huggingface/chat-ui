<script lang="ts">
	import { tick, untrack } from "svelte";
	import { SvelteMap, SvelteSet } from "svelte/reactivity";
	import { mlRegistry } from "$lib/stores/mlRegistry.svelte";
	import { sidePane } from "$lib/stores/sidePane.svelte";
	import type {
		MlRegistryAgentRun,
		MlRegistryArtefact,
		MlRegistryService,
		MlRegistrySource,
	} from "$lib/types/MlRegistry";
	import { serverCorrectedNow } from "$lib/utils/clockSkew.svelte";
	import { formatMicroUsd } from "$lib/utils/mlBudget";
	import {
		FILE_ORIGIN_LABEL,
		formatAgo,
		formatBytes,
		formatFileRef,
		groupArtefacts,
		groupSources,
		hubLabel,
		isServiceOpen,
		pathWithin,
		RUN_FAILURE_LABEL,
		RUN_FORCED_LABEL,
		runBadge,
		runElapsed,
		serviceDisplayName,
		serviceElapsed,
		servicesForFileVersion,
		shortCommit,
		sortServiceRows,
		splitSettled,
		sourcePath,
		sourceReaders,
		sourcesByReader,
		stageBadge,
		type ServiceRow,
	} from "$lib/utils/mlRegistry";
	import MlFileVersionView from "./MlFileVersionView.svelte";
	import SidePane from "./SidePane.svelte";

	import CarbonBook from "~icons/carbon/book";
	import CarbonChartLine from "~icons/carbon/chart-line";
	import CarbonChevronRight from "~icons/carbon/chevron-right";
	import CarbonChip from "~icons/carbon/chip";
	import CarbonCloseLarge from "~icons/carbon/close-large";
	import CarbonCube from "~icons/carbon/cube";
	import CarbonDataTable from "~icons/carbon/data-table";
	import CarbonDocument from "~icons/carbon/document";
	import CarbonEarth from "~icons/carbon/earth";
	import CarbonEducation from "~icons/carbon/education";
	import CarbonFolder from "~icons/carbon/folder";
	import CarbonLogoGithub from "~icons/carbon/logo-github";
	import CarbonRenew from "~icons/carbon/renew";
	import CarbonRocket from "~icons/carbon/rocket";
	import CarbonTerminal from "~icons/carbon/terminal";

	// read from the registry store and never the messages, so a job launched three turns
	// ago reads the same whether the pane was open for it or not

	const SERVICE_ICON = { job: CarbonChip, sandbox: CarbonTerminal } as const;
	const ARTEFACT_ICON = {
		model: CarbonCube,
		dataset: CarbonDataTable,
		space: CarbonRocket,
		bucket: CarbonFolder,
		file: CarbonDocument,
		dashboard: CarbonChartLine,
	} as const;
	const SOURCE_ICON = {
		paper: CarbonEducation,
		docs: CarbonBook,
		hub: CarbonCube,
		github: CarbonLogoGithub,
		web: CarbonEarth,
	} as const;

	const DISCOVERED_TITLE =
		"Seen in the arguments of a later tool call, not created here: nothing about it is verified";

	let showing = $derived(sidePane.open && sidePane.view === "registry");
	let serviceRows = $derived(sortServiceRows(mlRegistry.services, mlRegistry.agentRuns));
	let settled = $derived(splitSettled(serviceRows));
	let grouped = $derived(groupArtefacts(mlRegistry.artefacts));
	let openCount = $derived(mlRegistry.services.filter(isServiceOpen).length);
	let liveRunCount = $derived(
		mlRegistry.agentRuns.filter((run) => run.status === "running").length
	);
	let artefactCount = $derived(mlRegistry.artefacts.length);
	let files = $derived(mlRegistry.files);
	let sources = $derived(mlRegistry.sources);
	let sourceGroups = $derived(groupSources(sources));
	let readByRun = $derived(sourcesByReader(sources));

	const openFiles = new SvelteSet<string>();
	const shownVersions = new SvelteMap<string, number>();
	const openRuns = new SvelteSet<string>();
	const openGroups = new SvelteSet<string>();
	let showSettled = $state(false);

	const fileRowId = (name: string) => `ml-file-${name}`;
	const versionNumbers = (latest: number) =>
		Array.from({ length: latest }, (_, index) => latest - index);
	const runRowId = (id: string) => `ml-run-${id}`;
	const groupRowId = (key: string) => `ml-sources-${key}`;

	function closeFile(name: string) {
		openFiles.delete(name);
		shownVersions.delete(name);
	}

	/** opens on the latest version unless a pill picked another */
	function toggleFile(name: string) {
		if (openFiles.has(name)) closeFile(name);
		else openFiles.add(name);
	}

	function pickVersion(name: string, version: number) {
		const latest = files.find((file) => file.name === name)?.version;
		if (openFiles.has(name) && (shownVersions.get(name) ?? latest) === version) {
			closeFile(name);
			return;
		}
		openFiles.add(name);
		shownVersions.set(name, version);
	}

	function toggleRun(id: string) {
		if (openRuns.has(id)) openRuns.delete(id);
		else openRuns.add(id);
	}

	function toggleGroup(key: string) {
		if (openGroups.has(key)) openGroups.delete(key);
		else openGroups.add(key);
	}

	function revealRun(id: string) {
		openRuns.add(id);
		if (settled.settled.some((row) => row.key === `run:${id}`)) showSettled = true;
		void tick().then(() =>
			document.getElementById(runRowId(id))?.scrollIntoView({ block: "start" })
		);
	}

	$effect(() => {
		if (showing) void mlRegistry.refresh();
	});

	// the conversation left and took its rows, close like the other views do when their item goes
	$effect(() => {
		if (showing && mlRegistry.conversationId === undefined) sidePane.close();
	});

	$effect(() => {
		void mlRegistry.conversationId;
		untrack(() => {
			openFiles.clear();
			shownVersions.clear();
			openRuns.clear();
			openGroups.clear();
			showSettled = false;
		});
	});

	$effect(() => {
		if (!showing) return;
		for (const id of openRuns) {
			const run = mlRegistry.agentRuns.find((candidate) => candidate.id === id);
			// read so a run that moved on refetches its detail
			void run?.status;
			void run?.callCount;
			void run?.iterations;
			untrack(() => mlRegistry.loadRunDetail(id));
		}
	});

	$effect(() => {
		if (!showing) return;
		for (const name of openFiles) {
			// read so a newer version on the next poll refetches the list
			void files.find((file) => file.name === name)?.version;
			untrack(() => mlRegistry.loadFileVersions(name));
		}
	});

	// every open bumps the nonce, so asking twice for one version reveals it twice
	let openedFor = 0;
	let scrolledFor = 0;
	$effect(() => {
		const focus = sidePane.registryFocus;
		const nonce = sidePane.revealNonce;
		if (!showing || !focus) return;
		if (openedFor !== nonce) {
			openedFor = nonce;
			untrack(() => {
				openFiles.add(focus.name);
				shownVersions.set(focus.name, focus.version);
			});
		}
		if (scrolledFor === nonce) return;
		scrolledFor = nonce;
		void tick().then(() =>
			document.getElementById(fileRowId(focus.name))?.scrollIntoView({ block: "start" })
		);
	});

	// reseeded on every payload so a corrected skew lands at once
	let now = $state(serverCorrectedNow());
	$effect(() => {
		void mlRegistry.serverNow;
		now = serverCorrectedNow();
	});
	// elapsed times need the second, file ages only the minute
	let tickMs = $derived(openCount + liveRunCount > 0 ? 1000 : files.length > 0 ? 30_000 : 0);
	$effect(() => {
		if (!showing || tickMs === 0) return;
		const timer = setInterval(() => (now = serverCorrectedNow()), tickMs);
		return () => clearInterval(timer);
	});

	const serviceTitle = (service: MlRegistryService) =>
		`Open ${service.kind} ${service.jobId} on the Hub`;
	const artefactTitle = (artefact: MlRegistryArtefact) =>
		`Open ${artefact.kind} ${hubLabel(artefact.uri)} on the Hub`;
	const sourceTitle = (source: MlRegistrySource) =>
		`${source.title ? `${source.title}\n` : ""}${source.url}\nseen ${source.count} ${source.count === 1 ? "time" : "times"}, last ${source.lastSeenAt.toLocaleString()}`;
	const plural = (count: number, one: string, many = `${one}s`) =>
		`${count} ${count === 1 ? one : many}`;
</script>

{#snippet serviceItem(service: MlRegistryService)}
	{@const Icon = SERVICE_ICON[service.kind]}
	{@const badge = stageBadge(service.stage)}
	{@const elapsed = serviceElapsed(service, now)}
	<li class="ml-service flex gap-2.5 px-4 py-2.5" data-stage={badge.tone}>
		<Icon class="mt-[3px] size-[14px] flex-none text-[#78716c] dark:text-[#a8a29e]" />
		<div class="min-w-0 flex-1">
			<div class="flex items-center gap-2">
				<a
					href={service.hubUrl}
					target="_blank"
					rel="noopener noreferrer"
					class="ml-registry-link min-w-0 truncate font-medium text-[#1c1917] dark:text-[#f5f5f4]"
					title={serviceTitle(service)}
				>
					{serviceDisplayName(service)}
				</a>
				{#if service.origin === "discovered"}
					<span class="ml-registry-discovered" title={DISCOVERED_TITLE}>discovered</span>
				{/if}
				<span class="ml-stage ml-auto" data-tone={badge.tone}>
					{#if badge.tone === "running"}
						<span aria-hidden="true" class="ml-live-dot"></span>
					{/if}
					{badge.label}
				</span>
			</div>
			<div
				class="ml-service-meta mt-0.5 flex flex-wrap items-baseline gap-x-1.5 text-xs text-[#78716c] dark:text-[#a8a29e]"
			>
				<span>{service.kind}</span>
				{#if service.flavor}
					<span aria-hidden="true">·</span>
					<span class="font-mono">{service.flavor}</span>
				{/if}
				{#if elapsed}
					<span aria-hidden="true">·</span>
					<span class="ml-service-elapsed tabular-nums">{elapsed}</span>
				{/if}
				{#if service.heldMicroUsd !== undefined}
					<span aria-hidden="true">·</span>
					<span class="ml-service-hold font-mono text-[#c4511a] tabular-nums dark:text-[#f0a468]">
						holds {formatMicroUsd(service.heldMicroUsd)}
					</span>
				{/if}
			</div>
			{#if service.scriptRefs?.length}
				<div class="mt-1 flex flex-wrap gap-1.5">
					{#each service.scriptRefs as ref (formatFileRef(ref))}
						<button
							type="button"
							class="ml-file-ref"
							title="Show {formatFileRef(ref)} under Files"
							onclick={() => sidePane.openRegistry(ref)}
						>
							<CarbonDocument class="size-3 flex-none" />
							{formatFileRef(ref)}
						</button>
					{/each}
				</div>
			{/if}
			{#if service.tokenMissingSince}
				<p class="mt-0.5 text-xs text-[#a8a29e] dark:text-[#78716c]">
					Status unknown since the session expired.
				</p>
			{/if}
		</div>
	</li>
{/snippet}

{#snippet runItem(run: MlRegistryAgentRun)}
	{@const badge = runBadge(run)}
	{@const elapsed = runElapsed(run, now)}
	{@const isOpen = openRuns.has(run.id)}
	{@const opened = readByRun.get(run.id)?.opened ?? []}
	{@const foundOnly = readByRun.get(run.id)?.found.length ?? 0}
	<li class="ml-run" id={runRowId(run.id)} data-stage={badge.tone}>
		<button
			type="button"
			class="ml-file-toggle flex w-full items-start gap-2.5 px-4 py-2.5 text-left"
			aria-expanded={isOpen}
			aria-controls="{runRowId(run.id)}-detail"
			onclick={() => toggleRun(run.id)}
		>
			<CarbonChevronRight
				class="ml-file-chevron mt-[3px] size-[14px] flex-none text-[#a8a29e] dark:text-[#78716c]"
			/>
			<span class="block min-w-0 flex-1">
				<span class="flex items-center gap-2">
					<span class="min-w-0 truncate font-medium text-[#1c1917] dark:text-[#f5f5f4]">
						{run.displayName}
					</span>
					<span class="ml-stage ml-auto" data-tone={badge.tone}>
						{#if badge.tone === "running"}
							<span aria-hidden="true" class="ml-live-dot"></span>
						{/if}
						{badge.label}
					</span>
				</span>
				<span
					class="ml-service-meta mt-0.5 flex flex-wrap items-baseline gap-x-1.5 text-xs text-[#78716c] dark:text-[#a8a29e]"
				>
					<span title="Started by the {run.parent.tool} call">
						via <span class="font-mono">{run.parent.tool}</span>
					</span>
					<span aria-hidden="true">·</span>
					<span class="tabular-nums">{plural(run.callCount, "call")}</span>
					{#if elapsed}
						<span aria-hidden="true">·</span>
						<span class="ml-service-elapsed tabular-nums">{elapsed}</span>
					{/if}
					{#if opened.length}
						<span aria-hidden="true">·</span>
						<span class="tabular-nums">{plural(opened.length, "source")} read</span>
					{/if}
				</span>
				{#if run.status === "failed" && run.failure}
					<span class="ml-run-note mt-0.5 block text-xs" data-tone="error">
						{RUN_FAILURE_LABEL[run.failure]}
					</span>
				{:else if run.forcedBy}
					<span class="ml-run-note mt-0.5 block text-xs">
						{RUN_FORCED_LABEL[run.forcedBy]}
					</span>
				{/if}
			</span>
		</button>
		{#if isOpen}
			{@const load = mlRegistry.runDetail(run.id)}
			<div
				id="{runRowId(run.id)}-detail"
				class="ml-run-detail flex flex-col gap-3 pr-4 pb-3 pl-[40px] text-xs"
			>
				{#if load?.status === "ready"}
					{@const detail = load.value}
					<div>
						<h4 class="ml-run-label">Task</h4>
						<p class="ml-run-text">{detail.task}</p>
					</div>
					{#if detail.summary}
						<div>
							<h4 class="ml-run-label">Summary</h4>
							<p class="ml-run-text ml-run-summary scrollbar-custom">
								{detail.summary}
							</p>
						</div>
					{:else if detail.error}
						<div>
							<h4 class="ml-run-label">Error</h4>
							<p class="ml-run-text" data-tone="error">{detail.error}</p>
						</div>
					{/if}
					<div>
						<h4 class="ml-run-label">
							Calls
							<span class="ml-registry-count">{detail.callCount}</span>
						</h4>
						{#if detail.calls.length === 0}
							<p class="ml-file-note">No calls.</p>
						{:else}
							<ol
								class="ml-run-calls border-l border-[#ececea] dark:border-[#262626]"
								aria-label="Calls {run.displayName.toLowerCase()} made"
							>
								{#each detail.calls as call, index (index)}
									<li class="py-[3px] pl-3" data-status={call.status}>
										<span class="flex min-w-0 items-baseline gap-2">
											<span
												class="flex-none font-mono font-medium text-[#1c1917] dark:text-[#f5f5f4]"
											>
												{call.tool}
											</span>
											<span
												class="min-w-0 truncate font-mono text-[11px] text-[#78716c] dark:text-[#a8a29e]"
												title={call.args}
											>
												{call.args}
											</span>
										</span>
										{#if call.error}
											<span class="ml-run-note block truncate" data-tone="error" title={call.error}>
												{call.error}
											</span>
										{/if}
									</li>
								{/each}
							</ol>
							{#if detail.callCount > detail.calls.length}
								<p class="ml-file-note">
									{plural(detail.callCount - detail.calls.length, "later call")} not kept.
								</p>
							{/if}
						{/if}
					</div>
				{:else if load?.status === "error"}
					<p class="ml-file-note">
						Could not load the run.
						<button
							type="button"
							class="ml-file-retry"
							onclick={() => mlRegistry.loadRunDetail(run.id)}>Try again</button
						>
					</p>
				{:else}
					<p class="ml-file-note" role="status">Loading the run…</p>
				{/if}
				{#if opened.length || foundOnly}
					<div>
						<h4 class="ml-run-label">
							Sources
							<span class="ml-registry-count">{opened.length}</span>
						</h4>
						{#if opened.length}
							<ul class="ml-run-sources">
								{#each opened as source (source.id)}
									<li class="flex min-w-0 items-baseline gap-2 py-[2px]">
										<a
											href={source.url}
											target="_blank"
											rel="noopener noreferrer"
											class="ml-registry-link min-w-0 truncate text-[#57534e] dark:text-[#d6d3d1]"
											title={sourceTitle(source)}
										>
											{source.title ?? sourcePath(source)}
										</a>
										<span class="ml-auto flex-none text-[11px] text-[#a8a29e] dark:text-[#78716c]">
											{source.group}
										</span>
									</li>
								{/each}
							</ul>
						{/if}
						{#if foundOnly}
							<p class="ml-file-note">
								{plural(foundOnly, "more link")} only in its search results, listed under Sources.
							</p>
						{/if}
					</div>
				{/if}
			</div>
		{/if}
	</li>
{/snippet}

{#snippet serviceRow(row: ServiceRow)}
	{#if row.type === "service"}
		{@render serviceItem(row.service)}
	{:else}
		{@render runItem(row.run)}
	{/if}
{/snippet}

{#snippet sourceItem(source: MlRegistrySource, readers: readonly string[])}
	<li class="ml-source flex min-w-0 items-baseline gap-2 py-[3px] pl-3 text-xs">
		<span class="block min-w-0 flex-1">
			<a
				href={source.url}
				target="_blank"
				rel="noopener noreferrer"
				class="ml-registry-link ml-source-link block truncate"
				title={sourceTitle(source)}
			>
				{source.title ?? sourcePath(source)}
			</a>
			{#if source.title}
				<span class="ml-source-path block truncate font-mono text-[11px]">
					{sourcePath(source)}
				</span>
			{/if}
		</span>
		<span class="flex flex-none flex-wrap justify-end gap-1">
			{#each sourceReaders(readers, mlRegistry.agentRuns) as reader (reader.key)}
				{#if reader.runId}
					{@const runId = reader.runId}
					<button
						type="button"
						class="ml-source-reader"
						title="{reader.title}. Show the run"
						onclick={() => revealRun(runId)}
					>
						{reader.label}
					</button>
				{:else}
					<span class="ml-source-reader" title={reader.title}>{reader.label}</span>
				{/if}
			{/each}
		</span>
	</li>
{/snippet}

{#if showing}
	<SidePane label="Services and artifacts">
		<!-- container query, the pane is resizable and at phone width the title and controls take the row -->
		<header
			class="@container relative z-10 flex h-12 flex-none items-center gap-2 border-b border-gray-100 px-3 dark:border-gray-800"
		>
			<div class="flex min-w-0 flex-1 items-baseline gap-2">
				<h2 class="flex-none text-sm font-semibold text-gray-800 dark:text-gray-200">
					Services and artifacts
				</h2>
				{#if openCount + liveRunCount > 0}
					<span
						class="hidden truncate text-xs text-[#78716c] @min-[400px]:inline dark:text-[#a8a29e]"
					>
						{openCount + liveRunCount} running
					</span>
				{/if}
			</div>

			<div class="flex flex-none items-center gap-0.5 text-gray-500 dark:text-gray-400">
				<button
					type="button"
					class="btn rounded-md p-1.5 text-xs hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
					title="Refresh"
					aria-label="Refresh the list"
					onclick={() => mlRegistry.refresh()}
				>
					<CarbonRenew />
				</button>
				<button
					type="button"
					class="ml-0.5 btn rounded-md p-1 text-base hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
					title="Close panel (Esc)"
					onclick={() => sidePane.close()}
				>
					<CarbonCloseLarge />
				</button>
			</div>
		</header>

		<div
			class="ml-registry scrollbar-custom min-h-0 flex-1 overflow-y-auto bg-white text-[13px] leading-normal text-[#57534e] dark:bg-gray-900 dark:text-[#a8a29e]"
		>
			{#if !mlRegistry.loaded}
				<p class="ml-registry-empty" role="status">Loading…</p>
			{:else}
				<section aria-labelledby="ml-registry-services">
					<h3 id="ml-registry-services" class="ml-registry-heading">
						Services
						{#if serviceRows.length}
							<span class="ml-registry-count">{serviceRows.length}</span>
						{/if}
					</h3>
					{#if serviceRows.length === 0}
						<p class="ml-registry-empty">
							No jobs, sandboxes or sub-agent runs yet. They appear here as the intern launches
							them.
						</p>
					{:else}
						{#if settled.active.length}
							<ul class="ml-registry-list">
								{#each settled.active as row (row.key)}
									{@render serviceRow(row)}
								{/each}
							</ul>
						{/if}
						{#if settled.settled.length}
							<div class="ml-settled">
								<button
									type="button"
									class="ml-file-toggle ml-settled-toggle flex w-full items-center gap-2.5 px-4 py-2 text-left text-xs"
									aria-expanded={showSettled}
									aria-controls="ml-registry-settled"
									title="Ended, and the intern has already been told"
									onclick={() => (showSettled = !showSettled)}
								>
									<CarbonChevronRight
										class="ml-file-chevron size-[14px] flex-none text-[#a8a29e] dark:text-[#78716c]"
									/>
									<span class="tabular-nums">{settled.settled.length} ended</span>
								</button>
								{#if showSettled}
									<ul id="ml-registry-settled" class="ml-registry-list">
										{#each settled.settled as row (row.key)}
											{@render serviceRow(row)}
										{/each}
									</ul>
								{/if}
							</div>
						{/if}
					{/if}
				</section>

				<section aria-labelledby="ml-registry-artefacts">
					<h3 id="ml-registry-artefacts" class="ml-registry-heading">
						Artifacts
						{#if artefactCount}
							<span class="ml-registry-count">{artefactCount}</span>
						{/if}
					</h3>
					{#if artefactCount === 0}
						<p class="ml-registry-empty">
							Nothing on the Hub yet. Repos, files and dashboards the intern creates appear here.
						</p>
					{:else}
						<ul class="ml-registry-list">
							{#each grouped.repos as { repo, files } (repo.id)}
								{@const Icon = ARTEFACT_ICON[repo.kind]}
								<li class="ml-artefact px-4 py-2.5" data-kind={repo.kind}>
									<div class="flex items-center gap-2.5">
										<Icon class="size-[14px] flex-none text-[#78716c] dark:text-[#a8a29e]" />
										<a
											href={repo.url}
											target="_blank"
											rel="noopener noreferrer"
											class="ml-registry-link min-w-0 truncate font-medium text-[#1c1917] dark:text-[#f5f5f4]"
											title={artefactTitle(repo)}
										>
											{hubLabel(repo.uri)}
										</a>
										<span class="flex-none text-xs text-[#78716c] dark:text-[#a8a29e]"
											>{repo.kind}</span
										>
										{#if repo.origin === "discovered"}
											<span class="ml-registry-discovered" title={DISCOVERED_TITLE}>discovered</span
											>
										{/if}
									</div>
									{#if files.length}
										<ul
											class="ml-artefact-files mt-1.5 ml-[6px] border-l border-[#ececea] pl-[15px] dark:border-[#262626]"
										>
											{#each files as file (file.id)}
												<li class="flex items-center gap-2 py-[3px] text-xs">
													<CarbonDocument
														class="size-3 flex-none text-[#a8a29e] dark:text-[#78716c]"
													/>
													<a
														href={file.url}
														target="_blank"
														rel="noopener noreferrer"
														class="ml-registry-link min-w-0 truncate font-mono text-[#57534e] dark:text-[#d6d3d1]"
														title={artefactTitle(file)}
													>
														{pathWithin(file, repo)}
													</a>
													{#if file.commit}
														<span
															class="flex-none font-mono text-[11px] text-[#a8a29e] dark:text-[#78716c]"
															title="commit {file.commit}"
														>
															{shortCommit(file.commit)}
														</span>
													{/if}
													{#if file.origin === "discovered"}
														<span class="ml-registry-discovered" title={DISCOVERED_TITLE}
															>discovered</span
														>
													{/if}
												</li>
											{/each}
										</ul>
									{/if}
								</li>
							{/each}
							{#each grouped.orphans as file (file.id)}
								<li class="ml-artefact flex items-center gap-2.5 px-4 py-2.5" data-kind="file">
									<CarbonDocument
										class="size-[14px] flex-none text-[#78716c] dark:text-[#a8a29e]"
									/>
									<a
										href={file.url}
										target="_blank"
										rel="noopener noreferrer"
										class="ml-registry-link min-w-0 truncate font-mono text-[#1c1917] dark:text-[#f5f5f4]"
										title={artefactTitle(file)}
									>
										{hubLabel(file.uri)}
									</a>
									{#if file.commit}
										<span
											class="flex-none font-mono text-[11px] text-[#a8a29e] dark:text-[#78716c]"
											title="commit {file.commit}"
										>
											{shortCommit(file.commit)}
										</span>
									{/if}
								</li>
							{/each}
							{#each grouped.dashboards as dashboard (dashboard.id)}
								<li class="ml-artefact flex items-center gap-2.5 px-4 py-2.5" data-kind="dashboard">
									<CarbonChartLine
										class="size-[14px] flex-none text-[#78716c] dark:text-[#a8a29e]"
									/>
									<a
										href={dashboard.url}
										target="_blank"
										rel="noopener noreferrer"
										class="ml-registry-link min-w-0 truncate font-medium text-[#1c1917] dark:text-[#f5f5f4]"
										title={artefactTitle(dashboard)}
									>
										{hubLabel(dashboard.uri)}
									</a>
									<span class="flex-none text-xs text-[#78716c] dark:text-[#a8a29e]">dashboard</span
									>
									{#if dashboard.origin === "discovered"}
										<span class="ml-registry-discovered" title={DISCOVERED_TITLE}>discovered</span>
									{/if}
								</li>
							{/each}
						</ul>
					{/if}
				</section>

				<section aria-labelledby="ml-registry-files">
					<h3 id="ml-registry-files" class="ml-registry-heading">
						Files
						{#if files.length}
							<span class="ml-registry-count">{files.length}</span>
						{/if}
					</h3>
					{#if files.length === 0}
						<p class="ml-registry-empty">
							No files yet. Scripts and configs the intern writes appear here, with every version.
						</p>
					{:else}
						<ul class="ml-registry-list">
							{#each files as file (file.name)}
								{@const isOpen = openFiles.has(file.name)}
								{@const selected = shownVersions.get(file.name) ?? file.version}
								<li class="ml-file" id={fileRowId(file.name)} data-open={isOpen}>
									<div class="ml-file-head relative flex items-start gap-2.5 px-4 py-2.5">
										<button
											type="button"
											class="ml-file-toggle absolute inset-0"
											aria-expanded={isOpen}
											aria-controls="{fileRowId(file.name)}-version"
											aria-label="{isOpen ? 'Hide' : 'Show'} {file.name}"
											onclick={() => toggleFile(file.name)}
										></button>
										<CarbonChevronRight
											class="ml-file-chevron pointer-events-none mt-[3px] size-[14px] flex-none text-[#a8a29e] dark:text-[#78716c]"
										/>
										<span class="pointer-events-none block min-w-0 flex-1">
											<span
												class="ml-file-name block truncate font-mono font-medium text-[#1c1917] dark:text-[#f5f5f4]"
											>
												{file.name}
											</span>
											<span
												class="ml-file-meta mt-0.5 flex flex-wrap items-baseline gap-x-1.5 text-xs text-[#78716c] dark:text-[#a8a29e]"
											>
												<span class="tabular-nums">{formatBytes(file.size)}</span>
												<span aria-hidden="true">·</span>
												<span title={file.updatedAt.toLocaleString()}>
													updated {formatAgo(now - file.updatedAt.getTime())}
												</span>
											</span>
										</span>
										<span
											class="ml-file-versions relative flex max-w-[50%] flex-none flex-wrap justify-end gap-1"
											role="group"
											aria-label="Versions of {file.name}"
										>
											{#each versionNumbers(file.version) as version (version)}
												{@const isSelected = isOpen && selected === version}
												<button
													type="button"
													class="ml-version-pill"
													data-version={version}
													aria-pressed={isSelected}
													title={isSelected
														? `Hide v${version}`
														: version === 1
															? "Show v1"
															: `Show what v${version} changed`}
													onclick={() => pickVersion(file.name, version)}
												>
													v{version}
												</button>
											{/each}
										</span>
									</div>
									{#if isOpen}
										{@const load = mlRegistry.fileVersions(file.name)}
										{@const entry =
											load?.status === "ready"
												? load.value.find((candidate) => candidate.version === selected)
												: undefined}
										<div
											id="{fileRowId(file.name)}-version"
											class="ml-version pr-4 pb-3 pl-[40px]"
											data-version={selected}
										>
											{#if entry}
												{@const jobs = servicesForFileVersion(mlRegistry.services, {
													name: file.name,
													version: selected,
												})}
												<p class="flex items-baseline gap-2 text-xs">
													<span class="font-mono font-medium text-[#1c1917] dark:text-[#f5f5f4]">
														v{entry.version}
													</span>
													<span class="ml-version-origin">{FILE_ORIGIN_LABEL[entry.origin]}</span>
													{#if entry.agent}
														<span
															class="ml-version-agent"
															title="Written by the {entry.agent} sub-agent">{entry.agent}</span
														>
													{/if}
													<span
														class="ml-auto flex-none text-[#a8a29e] dark:text-[#78716c]"
														title={entry.createdAt.toLocaleString()}
													>
														{formatAgo(now - entry.createdAt.getTime())}
													</span>
												</p>
												{#if entry.summary}
													<p
														class="ml-version-summary mt-0.5 text-xs text-[#57534e] dark:text-[#d6d3d1]"
													>
														{entry.summary}
													</p>
												{/if}
												{#if entry.source}
													<p
														class="ml-version-source mt-0.5 truncate font-mono text-[11px] text-[#a8a29e] dark:text-[#78716c]"
														title={entry.source}
													>
														from {entry.source}
													</p>
												{/if}
												{#if jobs.length}
													<ul
														class="ml-version-jobs mt-1 flex flex-col gap-0.5"
														aria-label="Jobs that ran v{entry.version}"
													>
														{#each jobs as job (job.id)}
															{@const Icon = SERVICE_ICON[job.kind]}
															{@const badge = stageBadge(job.stage)}
															<li class="flex items-center gap-1.5 text-xs">
																<Icon class="size-3 flex-none text-[#a8a29e] dark:text-[#78716c]" />
																<a
																	href={job.hubUrl}
																	target="_blank"
																	rel="noopener noreferrer"
																	class="ml-registry-link min-w-0 truncate text-[#57534e] dark:text-[#d6d3d1]"
																	title={serviceTitle(job)}
																>
																	{serviceDisplayName(job)}
																</a>
																<span class="ml-stage" data-tone={badge.tone}>
																	{#if badge.tone === "running"}
																		<span aria-hidden="true" class="ml-live-dot"></span>
																	{/if}
																	{badge.label}
																</span>
															</li>
														{/each}
													</ul>
												{/if}
											{:else if load?.status === "error"}
												<p class="ml-file-note">
													Could not load the versions.
													<button
														type="button"
														class="ml-file-retry"
														onclick={() => mlRegistry.loadFileVersions(file.name)}>Try again</button
													>
												</p>
											{:else if load?.status !== "ready"}
												<p class="ml-file-note" role="status">Loading versions…</p>
											{/if}
											<MlFileVersionView name={file.name} version={selected} />
										</div>
									{/if}
								</li>
							{/each}
						</ul>
					{/if}
				</section>

				<section aria-labelledby="ml-registry-sources">
					<h3 id="ml-registry-sources" class="ml-registry-heading">
						Sources
						{#if sources.length}
							<span class="ml-registry-count">{sources.length}</span>
						{/if}
					</h3>
					{#if sources.length === 0}
						<p class="ml-registry-empty">
							No sources yet. Papers, docs, repos and web pages the intern reads appear here.
						</p>
					{:else}
						<ul class="ml-registry-list">
							{#each sourceGroups as group (group.key)}
								{@const Icon = SOURCE_ICON[group.kind]}
								{@const isOpen = openGroups.has(group.key)}
								<li class="ml-source-group" id={groupRowId(group.key)} data-kind={group.kind}>
									<button
										type="button"
										class="ml-file-toggle flex w-full items-center gap-2.5 px-4 py-2.5 text-left"
										aria-expanded={isOpen}
										aria-controls="{groupRowId(group.key)}-paths"
										onclick={() => toggleGroup(group.key)}
									>
										<CarbonChevronRight
											class="ml-file-chevron size-[14px] flex-none text-[#a8a29e] dark:text-[#78716c]"
										/>
										<Icon class="size-[14px] flex-none text-[#78716c] dark:text-[#a8a29e]" />
										<span
											class="ml-source-label min-w-0 flex-1 truncate font-medium text-[#1c1917] dark:text-[#f5f5f4]"
										>
											{group.label}
										</span>
										<span
											class="flex flex-none items-baseline gap-1.5 text-xs text-[#78716c] tabular-nums dark:text-[#a8a29e]"
										>
											{#if group.opened.length}
												<span class="ml-source-read">{group.opened.length} read</span>
											{/if}
											{#if group.found.length}
												<span class="ml-source-found-count">{group.found.length} found</span>
											{/if}
										</span>
									</button>
									{#if isOpen}
										<div id="{groupRowId(group.key)}-paths" class="pr-4 pb-3 pl-[40px]">
											{#if group.opened.length}
												<ul
													class="ml-source-paths border-l border-[#ececea] dark:border-[#262626]"
													aria-label="Pages read on {group.label}"
												>
													{#each group.opened as source (source.id)}
														{@render sourceItem(source, source.openedBy)}
													{/each}
												</ul>
											{/if}
											{#if group.found.length}
												<p class="ml-source-found-heading">Only in search results</p>
												<ul
													class="ml-source-paths border-l border-[#ececea] dark:border-[#262626]"
													data-found="true"
													aria-label="Links to {group.label} only in search results"
												>
													{#each group.found as source (source.id)}
														{@render sourceItem(source, source.readBy)}
													{/each}
												</ul>
											{/if}
										</div>
									{/if}
								</li>
							{/each}
						</ul>
					{/if}
				</section>
			{/if}
		</div>
	</SidePane>
{/if}

<style>
	/* the strip language, a neutral surface with orange as ink */
	.ml-registry-heading {
		display: flex;
		align-items: baseline;
		gap: 6px;
		padding: 14px 16px 6px;
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: #78716c;
	}

	:global(.dark) .ml-registry-heading {
		color: #a8a29e;
	}

	.ml-registry-count {
		font-family: var(--font-mono);
		font-size: 11px;
		font-weight: 500;
		letter-spacing: 0;
		color: #a8a29e;
	}

	.ml-registry-empty {
		padding: 4px 16px 16px;
		font-size: 13px;
		color: #a8a29e;
	}

	:global(.dark) .ml-registry-empty {
		color: #78716c;
	}

	.ml-registry-list > li + li {
		border-top: 1px solid #ececea;
	}

	:global(.dark) .ml-registry-list > li + li {
		border-top-color: #262626;
	}

	section + section,
	.ml-registry-list + .ml-settled {
		border-top: 1px solid #ececea;
	}

	:global(.dark) section + section,
	:global(.dark) .ml-registry-list + .ml-settled {
		border-top-color: #262626;
	}

	.ml-registry-link {
		transition: color 120ms ease;
	}

	.ml-registry-link:hover {
		color: #c4511a;
	}

	:global(.dark) .ml-registry-link:hover {
		color: #f0a468;
	}

	.ml-registry-link:focus-visible {
		outline: none;
		border-radius: 3px;
		box-shadow:
			0 0 0 2px #fff,
			0 0 0 3.5px #c4511a;
	}

	:global(.dark) .ml-registry-link:focus-visible {
		box-shadow:
			0 0 0 2px #111827,
			0 0 0 3.5px #f0a468;
	}

	/* dashed, the one badge that promises nothing */
	.ml-registry-discovered {
		flex: none;
		padding: 1px 6px;
		border: 1px dashed #d6d3d1;
		border-radius: 9999px;
		font-size: 11px;
		line-height: 1.2;
		color: #78716c;
	}

	:global(.dark) .ml-registry-discovered {
		border-color: #44403c;
		color: #a8a29e;
	}

	.ml-stage {
		display: inline-flex;
		flex: none;
		align-items: center;
		gap: 5px;
		height: 18px;
		padding: 0 7px;
		border-radius: 9999px;
		font-size: 11px;
		font-weight: 500;
		line-height: 1;
		white-space: nowrap;
	}

	.ml-stage[data-tone="running"] {
		color: #c4511a;
		background: rgba(232, 98, 42, 0.1);
	}

	.ml-stage[data-tone="queued"] {
		color: #57534e;
		background: rgba(0, 0, 0, 0.05);
	}

	.ml-stage[data-tone="completed"] {
		color: #15803d;
		background: rgba(22, 163, 74, 0.1);
	}

	.ml-stage[data-tone="error"] {
		color: #b91c1c;
		background: rgba(220, 38, 38, 0.1);
	}

	.ml-stage[data-tone="cancelled"] {
		color: #78716c;
		background: rgba(0, 0, 0, 0.05);
	}

	.ml-stage[data-tone="unknown"] {
		color: #78716c;
		box-shadow: inset 0 0 0 1px #d6d3d1;
	}

	:global(.dark) .ml-stage[data-tone="running"] {
		color: #f0a468;
		background: rgba(240, 164, 104, 0.12);
	}

	:global(.dark) .ml-stage[data-tone="queued"],
	:global(.dark) .ml-stage[data-tone="cancelled"] {
		color: #a8a29e;
		background: rgba(255, 255, 255, 0.07);
	}

	:global(.dark) .ml-stage[data-tone="completed"] {
		color: #4ade80;
		background: rgba(74, 222, 128, 0.12);
	}

	:global(.dark) .ml-stage[data-tone="error"] {
		color: #f87171;
		background: rgba(248, 113, 113, 0.12);
	}

	:global(.dark) .ml-stage[data-tone="unknown"] {
		color: #a8a29e;
		box-shadow: inset 0 0 0 1px #44403c;
	}

	.ml-file-toggle {
		transition: background-color 120ms ease;
	}

	.ml-file-toggle:hover {
		background: rgba(0, 0, 0, 0.03);
	}

	:global(.dark) .ml-file-toggle:hover {
		background: rgba(255, 255, 255, 0.04);
	}

	:global(.ml-file-chevron) {
		transition: transform 150ms ease;
	}

	/* a file row toggles from a button laid over it, so the chevron sits beside the button */
	.ml-file-toggle[aria-expanded="true"] :global(.ml-file-chevron),
	.ml-file[data-open="true"] > .ml-file-head > :global(.ml-file-chevron) {
		transform: rotate(90deg);
	}

	.ml-file-toggle:focus-visible,
	.ml-version-pill:focus-visible,
	.ml-file-ref:focus-visible,
	.ml-file-retry:focus-visible,
	.ml-source-reader:focus-visible {
		outline: none;
		box-shadow:
			inset 0 0 0 1.5px #c4511a,
			0 0 0 1px #fff;
	}

	:global(.dark) .ml-file-toggle:focus-visible,
	:global(.dark) .ml-version-pill:focus-visible,
	:global(.dark) .ml-file-ref:focus-visible,
	:global(.dark) .ml-file-retry:focus-visible,
	:global(.dark) .ml-source-reader:focus-visible {
		box-shadow:
			inset 0 0 0 1.5px #f0a468,
			0 0 0 1px #111827;
	}

	.ml-version-pill {
		flex: none;
		padding: 0 6px;
		border-radius: 9999px;
		background: rgba(0, 0, 0, 0.05);
		font-family: var(--font-mono);
		font-size: 11px;
		line-height: 18px;
		color: #57534e;
		transition:
			color 120ms ease,
			background-color 120ms ease;
	}

	.ml-version-pill:hover {
		color: #c4511a;
	}

	.ml-version-pill[aria-pressed="true"] {
		background: rgba(232, 98, 42, 0.14);
		color: #c4511a;
	}

	:global(.dark) .ml-version-pill {
		background: rgba(255, 255, 255, 0.07);
		color: #d6d3d1;
	}

	:global(.dark) .ml-version-pill:hover,
	:global(.dark) .ml-version-pill[aria-pressed="true"] {
		color: #f0a468;
	}

	:global(.dark) .ml-version-pill[aria-pressed="true"] {
		background: rgba(240, 164, 104, 0.14);
	}

	.ml-version-origin {
		color: #78716c;
	}

	:global(.dark) .ml-version-origin {
		color: #a8a29e;
	}

	.ml-version-agent,
	.ml-source-reader {
		flex: none;
		padding: 0 6px;
		border: 1px solid #e7e5e4;
		border-radius: 9999px;
		font-size: 11px;
		line-height: 16px;
		color: #57534e;
	}

	:global(.dark) .ml-version-agent,
	:global(.dark) .ml-source-reader {
		border-color: #44403c;
		color: #d6d3d1;
	}

	button.ml-source-reader {
		transition:
			color 120ms ease,
			border-color 120ms ease;
	}

	button.ml-source-reader:hover {
		border-color: #f0a468;
		color: #c4511a;
	}

	:global(.dark) button.ml-source-reader:hover {
		border-color: #c4511a;
		color: #f0a468;
	}

	.ml-run-label {
		display: flex;
		align-items: baseline;
		gap: 6px;
		margin-bottom: 2px;
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: #78716c;
	}

	:global(.dark) .ml-run-label {
		color: #a8a29e;
	}

	.ml-run-text {
		font-size: 12px;
		line-height: 1.5;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		color: #57534e;
	}

	:global(.dark) .ml-run-text {
		color: #d6d3d1;
	}

	.ml-run-summary {
		max-height: 16rem;
		overflow-y: auto;
		padding: 6px 8px;
		border-radius: 5px;
		background: rgba(0, 0, 0, 0.03);
	}

	:global(.dark) .ml-run-summary {
		background: rgba(255, 255, 255, 0.04);
	}

	.ml-run-note {
		color: #78716c;
	}

	:global(.dark) .ml-run-note {
		color: #a8a29e;
	}

	.ml-run-note[data-tone="error"],
	.ml-run-text[data-tone="error"] {
		color: #b91c1c;
	}

	:global(.dark) .ml-run-note[data-tone="error"],
	:global(.dark) .ml-run-text[data-tone="error"] {
		color: #f87171;
	}

	.ml-source-link {
		color: #1c1917;
	}

	:global(.dark) .ml-source-link {
		color: #f5f5f4;
	}

	.ml-source-path,
	.ml-source-found-count {
		color: #a8a29e;
	}

	:global(.dark) .ml-source-path,
	:global(.dark) .ml-source-found-count {
		color: #78716c;
	}

	.ml-source-found-heading {
		margin: 8px 0 2px;
		font-size: 11px;
		color: #a8a29e;
	}

	:global(.dark) .ml-source-found-heading {
		color: #78716c;
	}

	.ml-source-paths[data-found="true"] .ml-source-link {
		color: #a8a29e;
	}

	:global(.dark) .ml-source-paths[data-found="true"] .ml-source-link {
		color: #78716c;
	}

	.ml-file-note {
		padding: 4px 0;
		font-size: 12px;
		color: #a8a29e;
	}

	:global(.dark) .ml-file-note {
		color: #78716c;
	}

	.ml-file-retry {
		margin-left: 4px;
		border-radius: 3px;
		text-decoration: underline;
		text-underline-offset: 2px;
		color: #57534e;
	}

	:global(.dark) .ml-file-retry {
		color: #d6d3d1;
	}

	.ml-file-ref {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 1px 6px;
		border: 1px solid #e7e5e4;
		border-radius: 4px;
		font-family: var(--font-mono);
		font-size: 11px;
		line-height: 16px;
		color: #57534e;
		transition:
			color 120ms ease,
			border-color 120ms ease;
	}

	.ml-file-ref:hover {
		border-color: #f0a468;
		color: #c4511a;
	}

	:global(.dark) .ml-file-ref {
		border-color: #44403c;
		color: #d6d3d1;
	}

	:global(.dark) .ml-file-ref:hover {
		border-color: #c4511a;
		color: #f0a468;
	}

	/* the same 1.4s breath as the strip running step */
	.ml-live-dot {
		width: 6px;
		height: 6px;
		border-radius: 9999px;
		background: #e8622a;
		animation: ml-live-pulse 1.4s ease-in-out infinite;
	}

	@keyframes ml-live-pulse {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.35;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.ml-live-dot {
			animation: none;
		}
	}
</style>
