<script lang="ts">
	import { tick, untrack } from "svelte";
	import { SvelteMap, SvelteSet } from "svelte/reactivity";
	import { mlRegistry } from "$lib/stores/mlRegistry.svelte";
	import { sidePane } from "$lib/stores/sidePane.svelte";
	import type { MlFileRef } from "$lib/types/MlFile";
	import type { MlRegistryArtefact, MlRegistryService } from "$lib/types/MlRegistry";
	import { serverCorrectedNow } from "$lib/utils/clockSkew.svelte";
	import { formatMicroUsd } from "$lib/utils/mlBudget";
	import {
		FILE_ORIGIN_LABEL,
		formatAgo,
		formatBytes,
		formatFileRef,
		groupArtefacts,
		hubLabel,
		isServiceOpen,
		pathWithin,
		pushingService,
		repoPageUrl,
		serviceDisplayName,
		serviceElapsed,
		servicesForFileVersion,
		shortCommit,
		sortServices,
		stageBadge,
	} from "$lib/utils/mlRegistry";
	import MlFileVersionView from "./MlFileVersionView.svelte";
	import SidePane from "./SidePane.svelte";

	import CarbonChartLine from "~icons/carbon/chart-line";
	import CarbonChevronRight from "~icons/carbon/chevron-right";
	import CarbonChip from "~icons/carbon/chip";
	import CarbonCloseLarge from "~icons/carbon/close-large";
	import CarbonCloudUpload from "~icons/carbon/cloud-upload";
	import CarbonCube from "~icons/carbon/cube";
	import CarbonDataTable from "~icons/carbon/data-table";
	import CarbonDocument from "~icons/carbon/document";
	import CarbonFolder from "~icons/carbon/folder";
	import CarbonRenew from "~icons/carbon/renew";
	import CarbonRocket from "~icons/carbon/rocket";
	import CarbonTerminal from "~icons/carbon/terminal";
	import CarbonWarningAlt from "~icons/carbon/warning-alt";

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

	const DISCOVERED_TITLE =
		"Seen in the arguments of a later tool call, not created here: nothing about it is verified";
	const DISCOVERED_PUSH_TITLE =
		"Changed while the job ran, found by listing the namespace: the script did not name it";

	let showing = $derived(sidePane.open && sidePane.view === "registry");
	let services = $derived(sortServices(mlRegistry.services));
	let grouped = $derived(groupArtefacts(mlRegistry.artefacts));
	let openCount = $derived(services.filter(isServiceOpen).length);
	let artefactCount = $derived(mlRegistry.artefacts.length);
	let files = $derived(mlRegistry.files);

	const openFiles = new SvelteSet<string>();
	const shownVersions = new SvelteMap<string, number>();

	const fileRowId = (name: string) => `ml-file-${name}`;
	const versionRowId = ({ name, version }: MlFileRef) => `ml-file-${name}@v${version}`;

	function toggleFile(name: string) {
		if (openFiles.has(name)) openFiles.delete(name);
		else openFiles.add(name);
	}

	function toggleVersion(name: string, version: number) {
		if (shownVersions.get(name) === version) shownVersions.delete(name);
		else shownVersions.set(name, version);
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
		});
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
		// the version row only exists once the list has loaded
		const load = mlRegistry.fileVersions(focus.name);
		if (scrolledFor === nonce || !load || load.status === "loading") return;
		scrolledFor = nonce;
		void tick().then(() => {
			document.getElementById(fileRowId(focus.name))?.scrollIntoView({ block: "start" });
			document.getElementById(versionRowId(focus))?.scrollIntoView({ block: "nearest" });
		});
	});

	// reseeded on every payload so a corrected skew lands at once
	let now = $state(serverCorrectedNow());
	$effect(() => {
		void mlRegistry.serverNow;
		now = serverCorrectedNow();
	});
	// elapsed times need the second, file ages only the minute
	let tickMs = $derived(openCount > 0 ? 1000 : files.length > 0 ? 30_000 : 0);
	$effect(() => {
		if (!showing || tickMs === 0) return;
		const timer = setInterval(() => (now = serverCorrectedNow()), tickMs);
		return () => clearInterval(timer);
	});

	const serviceTitle = (service: MlRegistryService) =>
		`Open ${service.kind} ${service.jobId} on the Hub`;
	const artefactTitle = (artefact: MlRegistryArtefact) =>
		`Open ${artefact.kind} ${hubLabel(artefact.uri)} on the Hub`;
</script>

{#if showing}
	<SidePane label="Services and artefacts">
		<!-- container query, the pane is resizable and at phone width the title and controls take the row -->
		<header
			class="@container relative z-10 flex h-12 flex-none items-center gap-2 border-b border-gray-100 px-3 dark:border-gray-800"
		>
			<div class="flex min-w-0 flex-1 items-baseline gap-2">
				<h2 class="flex-none text-sm font-semibold text-gray-800 dark:text-gray-200">
					Services and artefacts
				</h2>
				{#if openCount > 0}
					<span
						class="hidden truncate text-xs text-[#78716c] @min-[400px]:inline dark:text-[#a8a29e]"
					>
						{openCount} running
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
						{#if services.length}
							<span class="ml-registry-count">{services.length}</span>
						{/if}
					</h3>
					{#if services.length === 0}
						<p class="ml-registry-empty">
							No jobs or sandboxes yet. They appear here as the intern launches them.
						</p>
					{:else}
						<ul class="ml-registry-list">
							{#each services as service (service.id)}
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
												<span class="ml-registry-discovered" title={DISCOVERED_TITLE}
													>discovered</span
												>
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
												<span
													class="ml-service-hold font-mono text-[#c4511a] tabular-nums dark:text-[#f0a468]"
												>
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
										{#if service.pushes?.length}
											<ul
												class="ml-service-pushes mt-1 flex flex-col gap-0.5"
												aria-label="What {serviceDisplayName(service)} pushed"
											>
												{#each service.pushes as push (push.uri)}
													{@const url = repoPageUrl(push.uri)}
													<li
														class="ml-push flex min-w-0 items-center gap-1.5 text-xs"
														data-status={push.status}
													>
														{#if push.status === "pushed"}
															<CarbonCloudUpload class="size-3 flex-none" />
															<span class="flex-none">pushed</span>
														{:else}
															<CarbonWarningAlt class="size-3 flex-none" />
															<span class="flex-none">nothing pushed to</span>
														{/if}
														{#if url}
															<a
																href={url}
																target="_blank"
																rel="noopener noreferrer"
																class="ml-registry-link min-w-0 truncate font-mono"
																title="Open {hubLabel(push.uri)} on the Hub"
															>
																{hubLabel(push.uri)}
															</a>
														{:else}
															<span class="min-w-0 truncate font-mono">{hubLabel(push.uri)}</span>
														{/if}
														{#if push.commit}
															<span
																class="flex-none font-mono text-[11px] text-[#a8a29e] dark:text-[#78716c]"
																title="commit {push.commit}"
															>
																{shortCommit(push.commit)}
															</span>
														{/if}
														{#if push.discovered}
															<span class="ml-registry-discovered" title={DISCOVERED_PUSH_TITLE}
																>discovered</span
															>
														{/if}
													</li>
												{/each}
											</ul>
										{/if}
										{#if service.tokenMissingSince}
											<p class="mt-0.5 text-xs text-[#a8a29e] dark:text-[#78716c]">
												Status unknown since the session expired.
											</p>
										{/if}
									</div>
								</li>
							{/each}
						</ul>
					{/if}
				</section>

				<section aria-labelledby="ml-registry-artefacts">
					<h3 id="ml-registry-artefacts" class="ml-registry-heading">
						Artefacts
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
								{@const pusher = pushingService(repo, mlRegistry.services)}
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
									{#if pusher}
										<p
											class="ml-artefact-pushed mt-0.5 flex min-w-0 items-baseline gap-1.5 pl-[24px] text-xs text-[#78716c] dark:text-[#a8a29e]"
										>
											<span class="flex-none">pushed by</span>
											<a
												href={pusher.hubUrl}
												target="_blank"
												rel="noopener noreferrer"
												class="ml-registry-link min-w-0 truncate text-[#57534e] dark:text-[#d6d3d1]"
												title={serviceTitle(pusher)}
											>
												{serviceDisplayName(pusher)}
											</a>
											{#if repo.commit}
												<span
													class="flex-none font-mono text-[11px] text-[#a8a29e] dark:text-[#78716c]"
													title="commit {repo.commit}"
												>
													{shortCommit(repo.commit)}
												</span>
											{/if}
										</p>
									{/if}
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
								{@const load = mlRegistry.fileVersions(file.name)}
								<li class="ml-file" id={fileRowId(file.name)}>
									<button
										type="button"
										class="ml-file-toggle flex w-full items-start gap-2.5 px-4 py-2.5 text-left"
										aria-expanded={isOpen}
										aria-controls="{fileRowId(file.name)}-versions"
										onclick={() => toggleFile(file.name)}
									>
										<CarbonChevronRight
											class="ml-file-chevron mt-[3px] size-[14px] flex-none text-[#a8a29e] dark:text-[#78716c]"
										/>
										<span class="block min-w-0 flex-1">
											<span class="flex items-center gap-2">
												<span
													class="ml-file-name min-w-0 truncate font-mono font-medium text-[#1c1917] dark:text-[#f5f5f4]"
												>
													{file.name}
												</span>
												<span class="ml-file-latest">v{file.version}</span>
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
											{#if file.summary}
												<span
													class="ml-file-summary mt-0.5 block text-xs text-[#57534e] dark:text-[#d6d3d1]"
												>
													{file.summary}
												</span>
											{/if}
										</span>
									</button>
									{#if isOpen}
										<div id="{fileRowId(file.name)}-versions" class="pr-4 pb-3 pl-[40px]">
											{#if load?.status === "ready"}
												<ol
													class="ml-file-versions border-l border-[#ececea] dark:border-[#262626]"
													aria-label="Versions of {file.name}"
												>
													{#each load.value as entry (entry.version)}
														{@const ref = { name: file.name, version: entry.version }}
														{@const jobs = servicesForFileVersion(mlRegistry.services, ref)}
														{@const isSelected = shownVersions.get(file.name) === entry.version}
														<li
															class="ml-version py-1 pl-3"
															id={versionRowId(ref)}
															data-version={entry.version}
														>
															<button
																type="button"
																class="ml-version-toggle w-full rounded-[5px] px-1.5 py-1 text-left"
																aria-pressed={isSelected}
																title={isSelected
																	? `Hide v${entry.version}`
																	: entry.version === 1
																		? "Show v1"
																		: `Show what v${entry.version} changed`}
																onclick={() => toggleVersion(file.name, entry.version)}
															>
																<span class="flex items-baseline gap-2 text-xs">
																	<span
																		class="font-mono font-medium text-[#1c1917] dark:text-[#f5f5f4]"
																	>
																		v{entry.version}
																	</span>
																	<span class="ml-version-origin">
																		{FILE_ORIGIN_LABEL[entry.origin]}
																	</span>
																	{#if entry.agent}
																		<span
																			class="ml-version-agent"
																			title="Written by the {entry.agent} sub-agent"
																			>{entry.agent}</span
																		>
																	{/if}
																	<span
																		class="ml-auto flex-none text-[#a8a29e] dark:text-[#78716c]"
																		title={entry.createdAt.toLocaleString()}
																	>
																		{formatAgo(now - entry.createdAt.getTime())}
																	</span>
																</span>
																{#if entry.summary}
																	<span
																		class="ml-version-summary mt-0.5 block text-xs text-[#57534e] dark:text-[#d6d3d1]"
																	>
																		{entry.summary}
																	</span>
																{/if}
																{#if entry.source}
																	<span
																		class="ml-version-source mt-0.5 block truncate font-mono text-[11px] text-[#a8a29e] dark:text-[#78716c]"
																		title={entry.source}
																	>
																		from {entry.source}
																	</span>
																{/if}
															</button>
															{#if jobs.length}
																<ul
																	class="ml-version-jobs mt-0.5 flex flex-col gap-0.5 px-1.5"
																	aria-label="Jobs that ran v{entry.version}"
																>
																	{#each jobs as job (job.id)}
																		{@const Icon = SERVICE_ICON[job.kind]}
																		{@const badge = stageBadge(job.stage)}
																		<li class="flex items-center gap-1.5 text-xs">
																			<Icon
																				class="size-3 flex-none text-[#a8a29e] dark:text-[#78716c]"
																			/>
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
															{#if isSelected}
																<MlFileVersionView name={file.name} version={entry.version} />
															{/if}
														</li>
													{/each}
												</ol>
											{:else if load?.status === "error"}
												<p class="ml-file-note">
													Could not load the versions.
													<button
														type="button"
														class="ml-file-retry"
														onclick={() => mlRegistry.loadFileVersions(file.name)}>Try again</button
													>
												</p>
											{:else}
												<p class="ml-file-note" role="status">Loading versions…</p>
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

	section + section {
		border-top: 1px solid #ececea;
	}

	:global(.dark) section + section {
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

	.ml-file-toggle,
	.ml-version-toggle {
		transition: background-color 120ms ease;
	}

	.ml-file-toggle:hover,
	.ml-version-toggle:hover {
		background: rgba(0, 0, 0, 0.03);
	}

	:global(.dark) .ml-file-toggle:hover,
	:global(.dark) .ml-version-toggle:hover {
		background: rgba(255, 255, 255, 0.04);
	}

	.ml-file-toggle :global(.ml-file-chevron) {
		transition: transform 150ms ease;
	}

	.ml-file-toggle[aria-expanded="true"] :global(.ml-file-chevron) {
		transform: rotate(90deg);
	}

	.ml-version-toggle[aria-pressed="true"] {
		background: rgba(232, 98, 42, 0.08);
		box-shadow: inset 2px 0 0 #e8622a;
	}

	:global(.dark) .ml-version-toggle[aria-pressed="true"] {
		background: rgba(240, 164, 104, 0.1);
		box-shadow: inset 2px 0 0 #f0a468;
	}

	.ml-file-toggle:focus-visible,
	.ml-version-toggle:focus-visible,
	.ml-file-ref:focus-visible,
	.ml-file-retry:focus-visible {
		outline: none;
		box-shadow:
			inset 0 0 0 1.5px #c4511a,
			0 0 0 1px #fff;
	}

	:global(.dark) .ml-file-toggle:focus-visible,
	:global(.dark) .ml-version-toggle:focus-visible,
	:global(.dark) .ml-file-ref:focus-visible,
	:global(.dark) .ml-file-retry:focus-visible {
		box-shadow:
			inset 0 0 0 1.5px #f0a468,
			0 0 0 1px #111827;
	}

	.ml-file-latest {
		flex: none;
		padding: 0 6px;
		border-radius: 9999px;
		background: rgba(0, 0, 0, 0.05);
		font-family: var(--font-mono);
		font-size: 11px;
		line-height: 18px;
		color: #57534e;
	}

	:global(.dark) .ml-file-latest {
		background: rgba(255, 255, 255, 0.07);
		color: #d6d3d1;
	}

	.ml-version-origin {
		color: #78716c;
	}

	:global(.dark) .ml-version-origin {
		color: #a8a29e;
	}

	.ml-version-agent {
		flex: none;
		padding: 0 6px;
		border: 1px solid #e7e5e4;
		border-radius: 9999px;
		font-size: 11px;
		line-height: 16px;
		color: #57534e;
	}

	:global(.dark) .ml-version-agent {
		border-color: #44403c;
		color: #d6d3d1;
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

	.ml-push {
		color: #78716c;
	}

	.ml-push[data-status="missing"] {
		color: #b91c1c;
	}

	:global(.dark) .ml-push {
		color: #a8a29e;
	}

	:global(.dark) .ml-push[data-status="missing"] {
		color: #f87171;
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
