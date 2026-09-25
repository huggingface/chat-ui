import type { MlRegistryArtefact, MlRegistryService } from "$lib/types/MlRegistry";

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
