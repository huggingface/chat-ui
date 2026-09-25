import { collections } from "$lib/server/database";
import { logger } from "$lib/server/logger";
import type { MlService, ServicePush } from "$lib/types/MlService";
import { parseHfUri, repoUri, repoUrl, type HfUri } from "./hubUri";
import { recordPushedRepo } from "./store";

// commit metadata only, never a file or a log, the model reads those itself

const HUB_API = "https://huggingface.co/api";
/** for the whole check, a slow hub must not hold the end event back longer */
const PUSH_CHECK_TIMEOUT_MS = 3_000;
/** after the end only, slack before the start would count the creation of a reserved repo */
const END_SLACK_MS = 60_000;
const LISTING_LIMIT = 20;
/** registry repos the script did not name, one read each, most recently touched first */
const MAX_KNOWN_REPOS = 5;
const MAX_NAMESPACES = 3;
const REPO_TYPES = ["models", "datasets"] as const;
/** dashboard storage changes during every run that logs to it */
const TRACKIO = /trackio/i;

type RepoType = (typeof REPO_TYPES)[number];
type Repo = HfUri & { type: RepoType };

interface Window {
	start: number;
	end: number;
}

interface Context {
	window: Window;
	/** commits written by puts from the conversation itself, not by the job */
	ownPuts: ReadonlySet<string>;
	token: string;
	signal: AbortSignal;
}

type Check = { status: "pushed"; repo: Repo; commit?: string } | { status: "missing"; repo: Repo };

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
	typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
const asString = (value: unknown): string | undefined =>
	typeof value === "string" && value.length > 0 ? value : undefined;
const parseDate = (value: unknown): Date | undefined => {
	if (typeof value !== "string") return undefined;
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? undefined : date;
};

function repoOf(uri: string): Repo | undefined {
	const parsed = parseHfUri(uri);
	if (!parsed || parsed.path || (parsed.type !== "models" && parsed.type !== "datasets")) {
		return undefined;
	}
	return { ...parsed, type: parsed.type };
}

const otherKind = (repo: Repo): Repo =>
	repo.type === "models"
		? { ...repo, type: "datasets", kind: "dataset" }
		: { ...repo, type: "models", kind: "model" };

const inWindow = (date: Date, window: Window) =>
	date.getTime() >= window.start && date.getTime() <= window.end;

const repoId = (repo: Repo) => `${repo.owner}/${repo.name}`;

const repoApi = (repo: Repo) => `${HUB_API}/${repo.type}/${repo.owner}/${repo.name}`;

async function hubGet(url: string, ctx: Context): Promise<unknown> {
	try {
		const res = await fetch(url, {
			headers: { Authorization: `Bearer ${ctx.token}`, Accept: "application/json" },
			signal: ctx.signal,
		});
		if (res.status === 404 || res.headers.get("x-error-code") === "RepoNotFound") return "absent";
		if (!res.ok) return undefined;
		return await res.json();
	} catch {
		return undefined;
	}
}

const EXPAND = "expand[]=sha&expand[]=lastModified&expand[]=createdAt";

interface RepoDates {
	sha?: string;
	lastModified?: Date;
	createdAt?: Date;
}

type RepoRead = ({ state: "found" } & RepoDates) | { state: "absent" };

function repoDates(record: Record<string, unknown>): RepoDates {
	const sha = asString(record.sha);
	const lastModified = parseDate(record.lastModified);
	const createdAt = parseDate(record.createdAt);
	return {
		...(sha ? { sha } : {}),
		...(lastModified ? { lastModified } : {}),
		...(createdAt ? { createdAt } : {}),
	};
}

/** a repo whose only commit is the one that created it holds nothing anyone pushed */
const onlyCreated = ({ lastModified, createdAt }: RepoDates): boolean =>
	lastModified !== undefined &&
	createdAt !== undefined &&
	lastModified.getTime() <= createdAt.getTime();

async function readRepo(repo: Repo, ctx: Context): Promise<RepoRead | undefined> {
	const body = await hubGet(`${repoApi(repo)}?${EXPAND}`, ctx);
	if (body === "absent") return { state: "absent" };
	const record = asRecord(body);
	return record ? { state: "found", ...repoDates(record) } : undefined;
}

async function readCommits(
	repo: Repo,
	ctx: Context
): Promise<{ id: string; date: Date }[] | undefined> {
	const body = await hubGet(`${repoApi(repo)}/commits/main`, ctx);
	if (!Array.isArray(body)) return undefined;
	return body.flatMap((entry) => {
		const record = asRecord(entry);
		const id = asString(record?.id);
		const date = parseDate(record?.date);
		return id && date ? [{ id, date }] : [];
	});
}

interface Listed extends RepoDates {
	repo: Repo;
	lastModified: Date;
}

async function listRecent(type: RepoType, namespace: string, ctx: Context) {
	const params = new URLSearchParams({
		author: namespace,
		sort: "lastModified",
		direction: "-1",
		limit: String(LISTING_LIMIT),
	});
	const body = await hubGet(`${HUB_API}/${type}?${params}&${EXPAND}`, ctx);
	if (!Array.isArray(body)) return undefined;
	return body.flatMap((entry): Listed[] => {
		const record = asRecord(entry);
		const id = asString(record?.id);
		const repo = id ? repoOf(`hf://${type}/${id}`) : undefined;
		if (!record || !repo) return [];
		const dates = repoDates(record);
		return dates.lastModified ? [{ ...dates, repo, lastModified: dates.lastModified }] : [];
	});
}

/** undefined when the hub could not say */
async function checkRepo(
	repo: Repo,
	ctx: Context,
	tryOtherKind: boolean
): Promise<Check | undefined> {
	let target = repo;
	let read = await readRepo(repo, ctx);
	// push_to_hub is shared by models and datasets, so the parsed kind can be a guess
	if (read?.state === "absent" && tryOtherKind) {
		const other = otherKind(repo);
		const otherRead = await readRepo(other, ctx);
		if (otherRead?.state !== "absent") {
			target = other;
			read = otherRead;
		}
	}
	if (!read) return undefined;
	if (read.state === "absent") return { status: "missing", repo };
	if (!read.lastModified) return undefined;
	if (read.lastModified.getTime() < ctx.window.start) return { status: "missing", repo: target };
	const ownOnTop = read.sha !== undefined && ctx.ownPuts.has(read.sha);
	if (read.lastModified.getTime() <= ctx.window.end && !ownOnTop && !onlyCreated(read)) {
		return { status: "pushed", repo: target, ...(read.sha ? { commit: read.sha } : {}) };
	}
	// a later commit, an own put or the creation is on top, the history shows what lies under it
	const commits = await readCommits(target, ctx);
	if (!commits) return undefined;
	const oldest = commits.at(-1);
	const creation =
		read.createdAt && oldest && oldest.date.getTime() <= read.createdAt.getTime()
			? oldest.id
			: undefined;
	const landed = commits.find(
		(commit) =>
			inWindow(commit.date, ctx.window) && !ctx.ownPuts.has(commit.id) && commit.id !== creation
	);
	return landed
		? { status: "pushed", repo: target, commit: landed.id }
		: { status: "missing", repo: target };
}

export interface PushCheckInput {
	service: MlService;
	startedAt?: Date;
	endedAt: Date;
	token: string;
	timeoutMs?: number;
}

/** never throws, undefined when nothing could be read in time */
export async function checkServicePushes({
	service,
	startedAt,
	endedAt,
	token,
	timeoutMs = PUSH_CHECK_TIMEOUT_MS,
}: PushCheckInput): Promise<ServicePush[] | undefined> {
	// a discovered id may be any run, its window would claim whatever the namespace pushed
	if (service.kind !== "job" || service.origin !== "dispatched") return undefined;
	const logFields = { conversationId: service.conversationId.toString(), jobId: service.jobId };
	try {
		const pushes = await check({ service, startedAt, endedAt, token, timeoutMs });
		if (pushes) {
			logger.info(
				{
					...logFields,
					pushed: pushes.filter((p) => p.status === "pushed").length,
					missing: pushes.filter((p) => p.status === "missing").length,
					discovered: pushes.filter((p) => p.discovered).length,
				},
				"[mlPushes] checked a job's destinations"
			);
		}
		return pushes;
	} catch (err) {
		logger.warn({ ...logFields, err: String(err) }, "[mlPushes] checking a job's pushes failed");
		return undefined;
	}
}

async function check({
	service,
	startedAt,
	endedAt,
	token,
	timeoutMs,
}: PushCheckInput & { timeoutMs: number }): Promise<ServicePush[] | undefined> {
	const { conversationId } = service;
	const window: Window = {
		start: (startedAt ?? service.createdAt).getTime(),
		end: endedAt.getTime() + END_SLACK_MS,
	};
	const [artefacts, others] = await Promise.all([
		collections.mlArtefacts
			.find(
				{ conversationId, kind: { $in: ["model", "dataset", "file"] } },
				{ projection: { kind: 1, uri: 1, commit: 1, updatedAt: 1 } }
			)
			.toArray(),
		collections.mlServices
			.find(
				{ conversationId, _id: { $ne: service._id }, "expectedPushes.0": { $exists: true } },
				{ projection: { expectedPushes: 1, createdAt: 1, startedAt: 1, endedAt: 1 } }
			)
			.toArray(),
	]);

	// a job that ran alongside and named the repo is the one that pushed it, told at its own end
	const claimedElsewhere = new Set(
		others
			.filter(
				(other) =>
					(other.startedAt ?? other.createdAt).getTime() <= window.end &&
					(other.endedAt?.getTime() ?? Infinity) >= window.start
			)
			.flatMap((other) => (other.expectedPushes ?? []).map((push) => push.uri))
	);
	const expected = (service.expectedPushes ?? []).flatMap((push) => {
		const repo = repoOf(push.uri);
		return repo ? [repo] : [];
	});
	const expectedUris = new Set(expected.map(repoUri));
	const expectedIds = new Set(expected.map(repoId));
	const repos = artefacts.filter((a) => a.kind === "model" || a.kind === "dataset");
	const knownUris = new Set(repos.map((a) => a.uri));
	// by id, an expected repo whose kind was a guess is read under both kinds already
	const known = repos
		.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
		.flatMap((a) => {
			const repo = repoOf(a.uri);
			return repo && !expectedIds.has(repoId(repo)) && !claimedElsewhere.has(a.uri) ? [repo] : [];
		})
		.slice(0, MAX_KNOWN_REPOS);
	const namespaces = [...new Set([service.namespace, ...expected.map((repo) => repo.owner)])].slice(
		0,
		MAX_NAMESPACES
	);

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	const ctx: Context = {
		window,
		ownPuts: new Set(artefacts.flatMap((a) => (a.kind === "file" && a.commit ? [a.commit] : []))),
		token,
		signal: controller.signal,
	};
	let expectedChecks: (Check | undefined)[];
	let knownChecks: (Check | undefined)[];
	let listings: (Listed[] | undefined)[];
	try {
		[expectedChecks, knownChecks, listings] = await Promise.all([
			Promise.all(expected.map((repo) => checkRepo(repo, ctx, true))),
			Promise.all(known.map((repo) => checkRepo(repo, ctx, false))),
			Promise.all(
				namespaces.flatMap((namespace) =>
					REPO_TYPES.map((type) => listRecent(type, namespace, ctx))
				)
			),
		]);
	} finally {
		clearTimeout(timer);
	}

	const answered = [...expectedChecks, ...knownChecks, ...listings].some(Boolean);
	if (!answered) return undefined;

	const decided = new Set<string>();
	const results: (Check & { discovered?: boolean })[] = [];
	expectedChecks.forEach((result, i) => {
		if (!result) return;
		decided.add(repoUri(expected[i])).add(repoUri(result.repo));
		results.push(result);
	});
	// a repo the registry knows but the script did not name is only news when it changed
	knownChecks.forEach((result, i) => {
		if (!result) return;
		decided.add(repoUri(known[i]));
		if (result.status === "pushed") results.push(result);
	});
	for (const listed of listings.flat()) {
		if (!listed) continue;
		const uri = repoUri(listed.repo);
		if (decided.has(uri) || claimedElsewhere.has(uri) || TRACKIO.test(listed.repo.name)) continue;
		if (!inWindow(listed.lastModified, window) || onlyCreated(listed)) continue;
		if (listed.sha && ctx.ownPuts.has(listed.sha)) continue;
		decided.add(uri);
		results.push({
			status: "pushed",
			repo: listed.repo,
			...(listed.sha ? { commit: listed.sha } : {}),
			discovered: !knownUris.has(uri) && !expectedUris.has(uri),
		});
	}

	await Promise.all(
		results.map(async (result) => {
			if (result.status !== "pushed") return;
			const uri = repoUri(result.repo);
			try {
				await recordPushedRepo({
					conversationId,
					kind: result.repo.kind === "dataset" ? "dataset" : "model",
					uri,
					url: repoUrl(result.repo),
					...(result.commit ? { commit: result.commit } : {}),
					serviceId: service._id,
				});
			} catch (err) {
				logger.warn(
					{ err: String(err), conversationId: conversationId.toString(), uri },
					"[mlPushes] recording a pushed repo failed"
				);
			}
		})
	);
	return results.map((result): ServicePush => ({
		uri: repoUri(result.repo),
		status: result.status,
		...(result.status === "pushed" && result.commit ? { commit: result.commit } : {}),
		...(result.discovered ? { discovered: true } : {}),
	}));
}
