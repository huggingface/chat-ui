import type { ObjectId } from "mongodb";
import { logger } from "$lib/server/logger";
import type { MlBudget, MlBudgetReservation } from "$lib/types/Conversation";
import { readMlBudget, settleReservation } from "./budget";

/**
 * Settle-on-read reconciliation, run at the start of each budgeted generation.
 *
 * A reservation holds a submission's worst case; the actual bill is the
 * minutes the job really ran. Once a job reaches a terminal stage, the
 * difference goes back to the budget. Between turns nothing settles — which
 * only ever holds too much, never spends too much — so running this lazily,
 * right before the remaining amount is next needed, is sound.
 */

const JOBS_API_BASE = "https://huggingface.co/api/jobs";
const FETCH_TIMEOUT_MS = 10_000;
/**
 * A reservation that never got a job id attached (transport failure mid-submit,
 * or an unparseable response) cannot be looked up. Once its job could not
 * possibly still be running — timeout plus generous slack — it settles at its
 * full ceiling: conservative, and it keeps the ledger from holding forever.
 */
const ORPHAN_SLACK_MS = 2 * 60 * 60 * 1000;

export const TERMINAL_STAGES: ReadonlySet<string> = new Set([
	"COMPLETED",
	"CANCELED",
	"ERROR",
	"DELETED",
]);

export interface JobStatus {
	stage: string;
	message?: string;
	startedAt?: Date;
	finishedAt?: Date;
	flavor?: string;
	timeoutSeconds?: number;
}

export type JobLookup =
	| { state: "terminal"; billedMinutes: number; job: JobStatus }
	/** any non-terminal stage, queued included */
	| { state: "running"; job: JobStatus }
	| { state: "gone" }
	| { state: "unknown" };

const parseDate = (value: unknown): Date | undefined => {
	if (typeof value !== "string" && typeof value !== "number") return undefined;
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? undefined : date;
};

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
	typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;

function parseJobStatus(body: Record<string, unknown>): JobStatus | undefined {
	const status = asRecord(body.status);
	const stage = typeof status?.stage === "string" ? status.stage : undefined;
	if (!stage) return undefined;
	const startedAt = parseDate(body.startedAt ?? body.started_at);
	const finishedAt = parseDate(body.finishedAt ?? body.finished_at);
	const timeoutSeconds = body.timeoutSeconds ?? body.timeout_seconds;
	return {
		stage,
		...(typeof status?.message === "string" ? { message: status.message } : {}),
		...(startedAt ? { startedAt } : {}),
		...(finishedAt ? { finishedAt } : {}),
		...(typeof body.flavor === "string" ? { flavor: body.flavor } : {}),
		...(typeof timeoutSeconds === "number" ? { timeoutSeconds } : {}),
	};
}

function jobsApiGet(url: string, token: string): Promise<Response> {
	return fetch(url, {
		headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
		signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
	});
}

/** one GET /api/jobs/{namespace}/{id}, a sandbox is a job so the same read serves both */
export async function lookupJob({
	namespace,
	jobId,
	token,
}: {
	namespace: string;
	jobId: string;
	token: string;
}): Promise<JobLookup> {
	let res: Response;
	try {
		res = await jobsApiGet(`${JOBS_API_BASE}/${encodeURIComponent(namespace)}/${jobId}`, token);
	} catch {
		return { state: "unknown" };
	}
	if (res.status === 404) return { state: "gone" };
	if (!res.ok) return { state: "unknown" };

	let body: Record<string, unknown>;
	try {
		body = (await res.json()) as Record<string, unknown>;
	} catch {
		return { state: "unknown" };
	}
	const job = parseJobStatus(body);
	if (!job) return { state: "unknown" };
	const { stage, startedAt, finishedAt } = job;
	if (!TERMINAL_STAGES.has(stage)) return { state: "running", job };

	// billing runs from start to finish, a job that never started billed nothing
	if (!startedAt) return { state: "terminal", billedMinutes: 0, job };
	const endedAt = finishedAt ?? new Date();
	const minutes = Math.ceil(Math.max(0, endedAt.getTime() - startedAt.getTime()) / 60_000);
	return { state: "terminal", billedMinutes: minutes, job };
}

export interface ListedJob extends JobStatus {
	jobId: string;
	createdAt?: Date;
	labels: Record<string, string>;
}

const JOB_ID = /^[0-9a-f]{24}$/;
/** more pages than this is not one session */
const MAX_LIST_PAGES = 10;

// the token goes with every page, so a next link off the hub is not followed
function nextPageUrl(link: string | null, base: string): string | undefined {
	const target = link?.match(/<([^>]+)>\s*;\s*rel="?next"?/)?.[1];
	if (!target) return undefined;
	try {
		const next = new URL(target, base);
		return next.origin === new URL(JOBS_API_BASE).origin ? next.toString() : undefined;
	} catch {
		return undefined;
	}
}

function parseListedJob(entry: unknown): ListedJob | undefined {
	const body = asRecord(entry);
	const jobId = body?.id;
	if (!body || typeof jobId !== "string" || !JOB_ID.test(jobId)) return undefined;
	const job = parseJobStatus(body);
	if (!job) return undefined;
	const createdAt = parseDate(body.createdAt ?? body.created_at);
	const labels = Object.fromEntries(
		Object.entries(asRecord(body.labels) ?? {}).filter(
			(entry): entry is [string, string] => typeof entry[1] === "string"
		)
	);
	return { ...job, jobId, ...(createdAt ? { createdAt } : {}), labels };
}

/** every label must match, undefined when any page cannot be read */
export async function listLabelledJobs({
	namespace,
	labels,
	token,
}: {
	namespace: string;
	labels: Record<string, string>;
	token: string;
}): Promise<ListedJob[] | undefined> {
	const params = new URLSearchParams();
	for (const [key, value] of Object.entries(labels)) params.append("label", `${key}=${value}`);
	let url: string | undefined = `${JOBS_API_BASE}/${encodeURIComponent(namespace)}?${params}`;
	const jobs: ListedJob[] = [];
	for (let page = 0; url && page < MAX_LIST_PAGES; page++) {
		let res: Response;
		let body: unknown;
		try {
			res = await jobsApiGet(url, token);
			if (!res.ok) return undefined;
			body = await res.json();
		} catch {
			return undefined;
		}
		if (!Array.isArray(body)) return undefined;
		for (const entry of body) {
			const job = parseListedJob(entry);
			if (job) jobs.push(job);
		}
		url = nextPageUrl(res.headers.get("link"), url);
	}
	return jobs;
}

/** Actual cost, never refunded past the ceiling and never negative. */
const actualMicroUsd = (reservation: MlBudgetReservation, billedMinutes: number): number =>
	Math.min(
		reservation.ceilingMicroUsd,
		Math.max(0, reservation.priceMicroUsdPerMinute * billedMinutes)
	);

export type EndedJobLookup = Extract<JobLookup, { state: "terminal" | "gone" }>;

/** the one hold a job read already in hand is for, matched by key else by job id, no second read */
export async function settleHoldFromLookup({
	conversationId,
	budget,
	reservationKey,
	jobId,
	lookup,
}: {
	conversationId: ObjectId;
	budget: MlBudget;
	reservationKey?: string;
	jobId: string;
	lookup: EndedJobLookup;
}): Promise<boolean> {
	const reservation = budget.reservations.find(
		(r) => (reservationKey !== undefined && r.key === reservationKey) || r.jobId === jobId
	);
	if (!reservation) return false;
	// a deleted job has no knowable runtime, charge the ceiling
	const actual =
		lookup.state === "terminal"
			? actualMicroUsd(reservation, lookup.billedMinutes)
			: reservation.ceilingMicroUsd;
	return settleReservation({ conversationId, key: reservation.key, actualMicroUsd: actual });
}

/**
 * Settle whatever can be settled and return the freshest budget. Failures skip
 * the reservation — it stays held, in the safe direction — and the next turn
 * tries again.
 */
export async function settleMlBudget({
	conversationId,
	budget,
	token,
	now = new Date(),
}: {
	conversationId: ObjectId;
	budget: MlBudget;
	/** Hub token the jobs are readable with; without one only orphan-age settles run. */
	token?: string;
	now?: Date;
}): Promise<MlBudget> {
	// Concurrent, not serial: this runs before the turn's first token, and each
	// lookup can spend its full timeout when the API is slow — N holds must cost
	// one timeout, not N. Open holds are few, so no concurrency cap is needed.
	const outcomes = await Promise.all(
		budget.reservations.map(async (reservation) => {
			if (reservation.jobId && reservation.namespace) {
				// Traceable: settle only from the API's answer. No token this turn
				// just means it stays held until a turn that has one.
				if (!token) return false;
				const lookup = await lookupJob({
					namespace: reservation.namespace,
					jobId: reservation.jobId,
					token,
				});
				if (lookup.state !== "terminal" && lookup.state !== "gone") return false;
				// A deleted job's runtime is unknowable: charge the ceiling.
				const actual =
					lookup.state === "terminal"
						? actualMicroUsd(reservation, lookup.billedMinutes)
						: reservation.ceilingMicroUsd;
				return settleReservation({ conversationId, key: reservation.key, actualMicroUsd: actual });
			}

			const deadline =
				reservation.createdAt.getTime() + reservation.timeoutSeconds * 1000 + ORPHAN_SLACK_MS;
			if (now.getTime() <= deadline) return false;
			logger.warn(
				{ key: reservation.key },
				"[mlBudget] settling an untraceable reservation at its ceiling"
			);
			return settleReservation({
				conversationId,
				key: reservation.key,
				actualMicroUsd: reservation.ceilingMicroUsd,
			});
		})
	);

	if (!outcomes.some(Boolean)) return budget;
	return (await readMlBudget(conversationId)) ?? budget;
}
