<script lang="ts">
	import { mlRegistry } from "$lib/stores/mlRegistry.svelte";
	import { sidePane } from "$lib/stores/sidePane.svelte";
	import type { MlRegistryArtefact, MlRegistryService } from "$lib/types/MlRegistry";
	import { serverCorrectedNow } from "$lib/utils/clockSkew.svelte";
	import { formatMicroUsd } from "$lib/utils/mlBudget";
	import {
		groupArtefacts,
		hubLabel,
		isServiceOpen,
		pathWithin,
		serviceDisplayName,
		serviceElapsed,
		shortCommit,
		sortServices,
		stageBadge,
	} from "$lib/utils/mlRegistry";
	import SidePane from "./SidePane.svelte";

	import CarbonChartLine from "~icons/carbon/chart-line";
	import CarbonChip from "~icons/carbon/chip";
	import CarbonCloseLarge from "~icons/carbon/close-large";
	import CarbonCube from "~icons/carbon/cube";
	import CarbonDataTable from "~icons/carbon/data-table";
	import CarbonDocument from "~icons/carbon/document";
	import CarbonFolder from "~icons/carbon/folder";
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

	const DISCOVERED_TITLE =
		"Seen in the arguments of a later tool call, not created here: nothing about it is verified";

	let showing = $derived(sidePane.open && sidePane.view === "registry");
	let services = $derived(sortServices(mlRegistry.services));
	let grouped = $derived(groupArtefacts(mlRegistry.artefacts));
	let openCount = $derived(services.filter(isServiceOpen).length);
	let artefactCount = $derived(mlRegistry.artefacts.length);

	$effect(() => {
		if (showing) void mlRegistry.refresh();
	});

	// reseeded on every payload so a corrected skew lands at once
	let now = $state(serverCorrectedNow());
	$effect(() => {
		void mlRegistry.serverNow;
		now = serverCorrectedNow();
	});
	$effect(() => {
		if (!showing || openCount === 0) return;
		const timer = setInterval(() => (now = serverCorrectedNow()), 1000);
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
