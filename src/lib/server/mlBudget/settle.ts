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

const TERMINAL_STAGES = new Set(["COMPLETED", "CANCELED", "ERROR", "DELETED"]);

type JobLookup =
	| { state: "terminal"; billedMinutes: number }
	| { state: "running" }
	| { state: "gone" }
	| { state: "unknown" };

const parseDate = (value: unknown): Date | undefined => {
	if (typeof value !== "string" && typeof value !== "number") return undefined;
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? undefined : date;
};

async function lookupJob({
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
		res = await fetch(`${JOBS_API_BASE}/${encodeURIComponent(namespace)}/${jobId}`, {
			headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
			signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
		});
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
	const status = body.status as Record<string, unknown> | undefined;
	const stage = typeof status?.stage === "string" ? status.stage : undefined;
	if (!stage || !TERMINAL_STAGES.has(stage)) return { state: "running" };

	// Billing runs from start to finish; a job that never started billed nothing.
	const startedAt = parseDate(body.startedAt ?? body.started_at);
	const finishedAt = parseDate(body.finishedAt ?? body.finished_at);
	if (!startedAt) return { state: "terminal", billedMinutes: 0 };
	const endedAt = finishedAt ?? new Date();
	const minutes = Math.ceil(Math.max(0, endedAt.getTime() - startedAt.getTime()) / 60_000);
	return { state: "terminal", billedMinutes: minutes };
}

/** Actual cost, never refunded past the ceiling and never negative. */
const actualMicroUsd = (reservation: MlBudgetReservation, billedMinutes: number): number =>
	Math.min(
		reservation.ceilingMicroUsd,
		Math.max(0, reservation.priceMicroUsdPerMinute * billedMinutes)
	);

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
	/** User's Hub token; without one only orphan-age settles run. */
	token?: string;
	now?: Date;
}): Promise<MlBudget> {
	let changed = false;

	for (const reservation of budget.reservations) {
		if (reservation.jobId && reservation.namespace) {
			// Traceable: settle only from the API's answer. No token this turn
			// just means it stays held until a turn that has one.
			if (!token) continue;
			const lookup = await lookupJob({
				namespace: reservation.namespace,
				jobId: reservation.jobId,
				token,
			});
			if (lookup.state === "terminal" || lookup.state === "gone") {
				// A deleted job's runtime is unknowable: charge the ceiling.
				const actual =
					lookup.state === "terminal"
						? actualMicroUsd(reservation, lookup.billedMinutes)
						: reservation.ceilingMicroUsd;
				changed =
					(await settleReservation({
						conversationId,
						key: reservation.key,
						actualMicroUsd: actual,
					})) || changed;
			}
			continue;
		}

		const deadline =
			reservation.createdAt.getTime() + reservation.timeoutSeconds * 1000 + ORPHAN_SLACK_MS;
		if (now.getTime() > deadline) {
			logger.warn(
				{ key: reservation.key },
				"[mlBudget] settling an untraceable reservation at its ceiling"
			);
			changed =
				(await settleReservation({
					conversationId,
					key: reservation.key,
					actualMicroUsd: reservation.ceilingMicroUsd,
				})) || changed;
		}
	}

	if (!changed) return budget;
	return (await readMlBudget(conversationId)) ?? budget;
}
