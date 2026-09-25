import type { MlAgentRunFailure } from "$lib/types/MlAgentRun";
import type { MlFile, MlFileRef } from "$lib/types/MlFile";
import type {
	MlRegistryAgentRun,
	MlRegistryArtefact,
	MlRegistrySource,
	MlRegistryService,
} from "$lib/types/MlRegistry";
import { PARENT_READER, type MlSourceKind } from "$lib/types/MlSource";
import type { HarnessServiceEvent } from "$lib/types/MessageUpdate";

/** the hub stages after which a job is never billed again */
const TERMINAL_STAGES = new Set(["COMPLETED", "CANCELED", "ERROR", "DELETED"]);

export const isTerminalStage = (stage: string): boolean => TERMINAL_STAGES.has(stage);

/**
 * open means the Hub would still bill it, which is what keeps the client polling
 * a hold counts because the sandbox create reply carries no stage, the row sits at UNKNOWN
 * until the poller asks while the budget already knows it is running, a discovered row has
 * no hold so it never keeps a poll alive on its own
 */
export function isServiceOpen(service: Pick<MlRegistryService, "stage" | "heldMicroUsd">): boolean {
	if (service.stage === "SCHEDULING" || service.stage === "RUNNING") return true;
	return service.stage === "UNKNOWN" && service.heldMicroUsd !== undefined;
}

export type StageTone = "running" | "queued" | "completed" | "error" | "cancelled" | "unknown";

export interface StageBadge {
	label: string;
	tone: StageTone;
}

export function stageBadge(stage: string): StageBadge {
	switch (stage) {
		case "RUNNING":
			return { label: "running", tone: "running" };
		case "SCHEDULING":
			return { label: "queued", tone: "queued" };
		case "COMPLETED":
			return { label: "completed", tone: "completed" };
		case "ERROR":
			return { label: "error", tone: "error" };
		case "CANCELED":
			return { label: "cancelled", tone: "cancelled" };
		case "DELETED":
			return { label: "deleted", tone: "cancelled" };
		default:
			return { label: "unknown", tone: "unknown" };
	}
}

/** the name the model gave, else enough of the job id to tell two apart */
export function serviceDisplayName(service: Pick<MlRegistryService, "name" | "jobId">): string {
	return service.name?.trim() || service.jobId.slice(0, 8);
}

const pad = (n: number) => String(n).padStart(2, "0");

/** 42s, 12m 05s, 3h 05m, 2d 4h, the trailing unit is padded so a ticking figure keeps its width */
export function formatElapsed(ms: number): string {
	const total = Math.max(0, Math.floor(ms / 1000));
	const days = Math.floor(total / 86_400);
	const hours = Math.floor((total % 86_400) / 3600);
	const minutes = Math.floor((total % 3600) / 60);
	const seconds = total % 60;
	if (days > 0) return `${days}d ${hours}h`;
	if (hours > 0) return `${hours}h ${pad(minutes)}m`;
	if (minutes > 0) return `${minutes}m ${pad(seconds)}s`;
	return `${seconds}s`;
}

/** the chip text a mid turn event leaves in the message, like sft-smoke failed after 2m 17s */
export function harnessEventLabel(
	event: Pick<HarnessServiceEvent, "name" | "jobId" | "to" | "ranSeconds">
): string {
	const badge = stageBadge(event.to);
	const verb = badge.tone === "error" ? "failed" : badge.tone === "unknown" ? "ended" : badge.label;
	const after =
		event.ranSeconds !== undefined ? ` after ${formatElapsed(event.ranSeconds * 1000)}` : "";
	return `${serviceDisplayName(event)} ${verb}${after}`;
}

/**
 * what the row says about time given a skew corrected now, nothing for a discovered row
 * because its createdAt is when the id was first seen in an argument, not when anything started
 */
export function serviceElapsed(
	service: Pick<
		MlRegistryService,
		"origin" | "stage" | "createdAt" | "updatedAt" | "startedAt" | "endedAt"
	>,
	now: number
): string | undefined {
	if (service.origin === "discovered") return undefined;
	if (service.stage === "SCHEDULING") {
		return `queued for ${formatElapsed(now - service.createdAt.getTime())}`;
	}
	const start = (service.startedAt ?? service.createdAt).getTime();
	// a terminal row without an endedAt was last written when its stage changed
	const end =
		service.endedAt?.getTime() ??
		(isTerminalStage(service.stage) ? service.updatedAt.getTime() : now);
	return formatElapsed(end - start);
}

/** running, then the rest of what is open, then everything else, newest first within each */
export function sortServices(services: readonly MlRegistryService[]): MlRegistryService[] {
	const rank = (service: MlRegistryService) =>
		service.stage === "RUNNING" ? 0 : isServiceOpen(service) ? 1 : 2;
	return [...services].sort(
		(a, b) => rank(a) - rank(b) || b.createdAt.getTime() - a.createdAt.getTime()
	);
}

export function runBadge(run: Pick<MlRegistryAgentRun, "status">): StageBadge {
	switch (run.status) {
		case "running":
			return { label: "running", tone: "running" };
		case "completed":
			return { label: "completed", tone: "completed" };
		case "failed":
			return { label: "failed", tone: "error" };
		case "aborted":
			return { label: "stopped", tone: "cancelled" };
		case "interrupted":
			return { label: "interrupted", tone: "unknown" };
	}
}

export function runElapsed(
	run: Pick<MlRegistryAgentRun, "status" | "startedAt" | "endedAt">,
	now: number
): string | undefined {
	if (run.endedAt) return formatElapsed(run.endedAt.getTime() - run.startedAt.getTime());
	return run.status === "running" ? formatElapsed(now - run.startedAt.getTime()) : undefined;
}

export const RUN_FAILURE_LABEL: Record<MlAgentRunFailure, string> = {
	no_tools: "had no tools to use",
	context_limit: "ran out of context",
	iteration_limit: "hit its step limit",
	no_summary: "returned no summary",
	rate_limited: "was rate limited",
	llm_error: "model request failed",
	internal_error: "crashed",
};

export const RUN_FORCED_LABEL: Record<NonNullable<MlRegistryAgentRun["forcedBy"]>, string> = {
	context_limit: "summary forced by the context limit",
	iteration_limit: "summary forced by the step limit",
};

export type ServiceRow =
	| { type: "service"; key: string; service: MlRegistryService }
	| { type: "run"; key: string; run: MlRegistryAgentRun };

/** hub services and sub-agent runs in one list, running first, then open, then the rest, newest first */
export function sortServiceRows(
	services: readonly MlRegistryService[],
	runs: readonly MlRegistryAgentRun[]
): ServiceRow[] {
	const rows = [
		...services.map((service) => ({
			row: { type: "service", key: `service:${service.id}`, service } as const,
			rank: service.stage === "RUNNING" ? 0 : isServiceOpen(service) ? 1 : 2,
			at: service.createdAt.getTime(),
		})),
		...runs.map((run) => ({
			row: { type: "run", key: `run:${run.id}`, run } as const,
			rank: run.status === "running" ? 0 : 2,
			at: run.startedAt.getTime(),
		})),
	];
	return rows.sort((a, b) => a.rank - b.rank || b.at - a.at).map(({ row }) => row);
}

/**
 * ended and already told to the agent, nothing left to watch, a run hands its result to the
 * agent when it ends but an interrupted one never did
 */
export function isSettledRow(row: ServiceRow): boolean {
	if (row.type === "run") return row.run.status !== "running" && row.run.status !== "interrupted";
	const { stage, lastReportedStage } = row.service;
	return isTerminalStage(stage) && lastReportedStage === stage;
}

/** what still needs watching, and underneath it what has settled */
export function splitSettled(rows: readonly ServiceRow[]): {
	active: ServiceRow[];
	settled: ServiceRow[];
} {
	return {
		active: rows.filter((row) => !isSettledRow(row)),
		settled: rows.filter(isSettledRow),
	};
}

export interface SourceGroup {
	key: string;
	label: string;
	kind: MlSourceKind;
	/** read, most recent first */
	opened: MlRegistrySource[];
	/** only in search results, most recent first */
	found: MlRegistrySource[];
}

const byLastSeen = (a: MlRegistrySource, b: MlRegistrySource) =>
	b.lastSeenAt.getTime() - a.lastSeenAt.getTime();

/** by group, a github repo and a hub repo of one name stay apart, the most read groups first */
export function groupSources(sources: readonly MlRegistrySource[]): SourceGroup[] {
	const groups = new Map<string, SourceGroup>();
	for (const source of sources) {
		const key = `${source.kind === "github" ? "github" : source.kind === "hub" ? "hub" : "site"}:${source.group}`;
		let group = groups.get(key);
		if (!group) {
			group = { key, label: source.group, kind: source.kind, opened: [], found: [] };
			groups.set(key, group);
		}
		(source.opened ? group.opened : group.found).push(source);
	}
	for (const group of groups.values()) {
		group.opened.sort(byLastSeen);
		group.found.sort(byLastSeen);
	}
	return [...groups.values()].sort(
		(a, b) =>
			b.opened.length - a.opened.length ||
			b.opened.length + b.found.length - (a.opened.length + a.found.length) ||
			a.label.localeCompare(b.label)
	);
}

const safeDecode = (text: string) => {
	try {
		return decodeURIComponent(text);
	} catch {
		return text;
	}
};

/** where in its group a source sits, the path a person would recognise */
export function sourcePath(source: Pick<MlRegistrySource, "url" | "kind">): string {
	let url: URL;
	try {
		url = new URL(source.url);
	} catch {
		return source.url;
	}
	const path = safeDecode(url.pathname);
	switch (source.kind) {
		case "paper":
			return path.replace(/^\/papers\//, "");
		case "docs":
			return path.replace(/^\/docs\//, "");
		case "github":
		case "hub": {
			const blob = /\/(?:blob|resolve)\/[^/]+\/(.+)$/.exec(path);
			return blob ? blob[1] : "repo page";
		}
		case "web":
			return `${path === "/" ? "" : path}${safeDecode(url.search)}` || "/";
	}
}

export interface ReaderSources {
	/** what this reader opened, most recent first */
	opened: MlRegistrySource[];
	/** what only came back to this reader in search results, even if another reader opened it */
	found: MlRegistrySource[];
}

/** the sources of each reader, the run detail lists what that run read */
export function sourcesByReader(sources: readonly MlRegistrySource[]): Map<string, ReaderSources> {
	const byReader = new Map<string, ReaderSources>();
	for (const source of sources) {
		for (const reader of source.readBy) {
			let entry = byReader.get(reader);
			if (!entry) {
				entry = { opened: [], found: [] };
				byReader.set(reader, entry);
			}
			(source.openedBy.includes(reader) ? entry.opened : entry.found).push(source);
		}
	}
	for (const entry of byReader.values()) {
		entry.opened.sort(byLastSeen);
		entry.found.sort(byLastSeen);
	}
	return byReader;
}

export interface SourceReader {
	key: string;
	label: string;
	title: string;
	/** the run that read it, when the listing still has it */
	runId?: string;
}

/** readers by name, the main agent as main and each sub-agent run by its label */
export function sourceReaders(
	readers: readonly string[],
	runs: readonly MlRegistryAgentRun[]
): SourceReader[] {
	return readers.map((reader) => {
		if (reader === PARENT_READER) {
			return { key: reader, label: "main", title: "Read by the main agent" };
		}
		const run = runs.find((candidate) => candidate.id === reader);
		if (!run) return { key: reader, label: "sub-agent", title: "Read by a sub-agent" };
		return {
			key: reader,
			label: run.label,
			title: `Read by the ${run.displayName.toLowerCase()} sub-agent started ${run.startedAt.toLocaleString()}`,
			runId: run.id,
		};
	});
}

type GroupableArtefact = Pick<MlRegistryArtefact, "kind" | "uri" | "createdAt">;

export interface ArtefactGroup<T extends GroupableArtefact = MlRegistryArtefact> {
	repo: T;
	/** the files written under it, by path */
	files: T[];
}

export interface GroupedArtefacts<T extends GroupableArtefact = MlRegistryArtefact> {
	repos: ArtefactGroup<T>[];
	/** files whose repo row is missing, shown on their own */
	orphans: T[];
	dashboards: T[];
}

const byCreatedAt = (a: GroupableArtefact, b: GroupableArtefact) =>
	a.createdAt.getTime() - b.createdAt.getTime();

/** repos in the order they were made, each with its files nested, then dashboards */
export function groupArtefacts<T extends GroupableArtefact>(
	artefacts: readonly T[]
): GroupedArtefacts<T> {
	const repos: ArtefactGroup<T>[] = artefacts
		.filter((artefact) => artefact.kind !== "file" && artefact.kind !== "dashboard")
		.sort(byCreatedAt)
		.map((repo) => ({ repo, files: [] }));
	const orphans: T[] = [];
	for (const file of artefacts.filter((artefact) => artefact.kind === "file")) {
		// the slash keeps a repo from claiming a sibling whose name extends its own
		const group = repos.find(({ repo }) => file.uri.startsWith(`${repo.uri}/`));
		(group?.files ?? orphans).push(file);
	}
	for (const group of repos) group.files.sort((a, b) => a.uri.localeCompare(b.uri));
	return {
		repos,
		orphans: orphans.sort(byCreatedAt),
		dashboards: artefacts.filter((artefact) => artefact.kind === "dashboard").sort(byCreatedAt),
	};
}

/** the path of a file below its repo uri */
export const pathWithin = (file: MlRegistryArtefact, repo: MlRegistryArtefact): string =>
	file.uri.slice(repo.uri.length + 1);

/** the uri without its scheme and repo type */
export function hubLabel(uri: string): string {
	const match = /^hf:\/\/[^/]+\/(.+)$/.exec(uri);
	return match?.[1] ?? uri;
}

export const shortCommit = (commit: string): string => commit.slice(0, 7);

export const formatFileRef = ({ name, version }: MlFileRef): string => `${name} v${version}`;

/** the jobs and sandboxes whose script was this version, sorted like the services list */
export function servicesForFileVersion(
	services: readonly MlRegistryService[],
	{ name, version }: MlFileRef
): MlRegistryService[] {
	return sortServices(
		services.filter((service) =>
			service.scriptRefs?.some((ref) => ref.name === name && ref.version === version)
		)
	);
}

export const FILE_ORIGIN_LABEL: Record<MlFile["origin"], string> = {
	write: "written",
	edit: "edited",
	import: "imported",
};

export function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	const kb = bytes / 1024;
	if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
	return `${(kb / 1024).toFixed(1)} MB`;
}

export function formatAgo(ms: number): string {
	const seconds = Math.max(0, Math.floor(ms / 1000));
	if (seconds < 45) return "just now";
	if (seconds < 3600) return `${Math.max(1, Math.round(seconds / 60))}m ago`;
	if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
	return `${Math.floor(seconds / 86_400)}d ago`;
}

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
	py: "python",
	sh: "bash",
	bash: "bash",
	yaml: "yaml",
	yml: "yaml",
	json: "json",
	jsonl: "json",
	md: "markdown",
	js: "javascript",
	mjs: "javascript",
	ts: "typescript",
	html: "html",
	css: "css",
	sql: "sql",
};

/** plaintext for anything unknown, auto-detection is slow and guesses wrong on configs */
export function fileLanguage(name: string): string {
	const extension = /\.([A-Za-z0-9]+)$/.exec(name)?.[1]?.toLowerCase();
	return (extension && LANGUAGE_BY_EXTENSION[extension]) || "plaintext";
}
