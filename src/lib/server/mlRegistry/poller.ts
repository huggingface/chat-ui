import type { ObjectId, UpdateFilter } from "mongodb";
import { collections } from "$lib/server/database";
import { config } from "$lib/server/config";
import { logger } from "$lib/server/logger";
import { onExit } from "$lib/server/exitHandler";
import { pinnedHubToken } from "$lib/server/mlAssistant";
import { readMlBudget } from "$lib/server/mlBudget/budget";
import {
	lookupJob,
	settleHoldFromLookup,
	TERMINAL_STAGES,
	type EndedJobLookup,
	type JobStatus,
} from "$lib/server/mlBudget/settle";
import { rebuildIdentity } from "$lib/server/generation/parkedSweeper";
import type { MlService } from "$lib/types/MlService";
import { backoffDelayMs, nextPollDelayMs } from "./schedule";
import { mlPushChecksEnabled, mlServiceEventsEnabled } from "./enabled";
import { conversationsAwaitingEvents, deliverServiceEvents, endEventFields } from "./events";
import { checkServicePushes } from "./pushCheck";
import { claimDueReconcile, reconcileSession } from "./reconcile";

// status only and never logs, an end is marked on the row for deliverServiceEvents

const CLAIM_BATCH = 20;
const RECONCILE_BATCH = 5;
/** a pod that dies mid poll leaves its rows due again once this has passed */
const CLAIM_LEASE_MS = 60_000;
const NO_TOKEN_DELAY_MS = 5 * 60_000;
const MAX_POLL_FAILURES = 50;
const STAGE_HISTORY_CAP = 8;
/** past its timeout plus this a job cannot still be running */
const TIMEOUT_SLACK_MS = 2 * 60 * 60 * 1000;
/** a discovered row learns its timeout from its first successful poll, until then assume the day a sandbox gets */
const DEFAULT_TIMEOUT_SECONDS = 24 * 60 * 60;

const TERMINAL = [...TERMINAL_STAGES];

function pollIntervalMs(): number {
	const raw = config.ML_ASSISTANT_SERVICE_POLL_INTERVAL_MS;
	const parsed = raw ? parseInt(raw, 10) : NaN;
	return !isNaN(parsed) && parsed > 0 ? parsed : 5_000;
}

// the write that selects the row also pushes nextPollAt past the lease, so two pods get
// one winner, a row with no nextPollAt predates the poller and is simply due
export async function claimDueService(now: Date): Promise<MlService | null> {
	const claimed = await collections.mlServices.findOneAndUpdate(
		{
			stage: { $nin: TERMINAL },
			pollStoppedReason: { $exists: false },
			$or: [{ nextPollAt: { $lte: now } }, { nextPollAt: { $exists: false } }],
		},
		{ $set: { nextPollAt: new Date(now.getTime() + CLAIM_LEASE_MS) } },
		{ sort: { nextPollAt: 1 }, returnDocument: "after" }
	);
	return claimed?.value ?? null;
}

type TokenCache = Map<string, Promise<string | undefined>>;

// no request to read a token from, an operator pinned hub entry comes first since jobs
// launched under it are only readable as it, else the most recent session of the owner
async function resolveToken(conversationId: ObjectId): Promise<string | undefined> {
	const pinned = pinnedHubToken();
	if (pinned) return pinned;
	const conv = await collections.conversations.findOne(
		{ _id: conversationId },
		{ projection: { userId: 1, sessionId: 1 } }
	);
	if (!conv) return undefined;
	const { locals } = await rebuildIdentity({ userId: conv.userId, sessionId: conv.sessionId });
	return locals.token;
}

function tokenFor(conversationId: ObjectId, cache: TokenCache): Promise<string | undefined> {
	const key = conversationId.toString();
	let pending = cache.get(key);
	if (!pending) {
		pending = resolveToken(conversationId);
		cache.set(key, pending);
	}
	return pending;
}

export interface PollOutcome {
	/** the row as it was claimed */
	service: MlService;
	previousStage: string;
	stage: string;
	terminal: boolean;
}

const pastDeadline = (service: MlService, now: Date): boolean =>
	now.getTime() >
	service.createdAt.getTime() +
		(service.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS) * 1000 +
		TIMEOUT_SLACK_MS;

const stopped = (reason: string, now: Date): UpdateFilter<MlService> => ({
	$set: { pollStoppedReason: reason, updatedAt: now },
	$unset: { nextPollAt: "" },
});

/** only what the row does not already know, dispatched rows carry these from the submit reply */
const fillFromBody = (service: MlService, job: JobStatus): Partial<MlService> => ({
	...(!service.flavor && job.flavor ? { flavor: job.flavor } : {}),
	...(!service.timeoutSeconds && job.timeoutSeconds ? { timeoutSeconds: job.timeoutSeconds } : {}),
});

const historyEntry = (stage: string, now: Date): UpdateFilter<MlService> => ({
	$push: { stageHistory: { $each: [{ stage, at: now }], $slice: -STAGE_HISTORY_CAP } },
});

async function writeRow(service: MlService, update: UpdateFilter<MlService>): Promise<void> {
	await collections.mlServices.updateOne({ _id: service._id }, update);
}

// runs before the row is marked ended, so a settle that throws leaves the row on its lease
// and the next claim reads the job and settles again
async function settleHold(service: MlService, lookup: EndedJobLookup): Promise<void> {
	const budget = await readMlBudget(service.conversationId);
	if (!budget) return;
	await settleHoldFromLookup({
		conversationId: service.conversationId,
		budget,
		reservationKey: service.reservationKey,
		jobId: service.jobId,
		lookup,
	});
}

/** every path writes the next due time or unsets it for good, so a claimed row never sits on its lease */
export async function pollService(
	service: MlService,
	token: string | undefined,
	now: Date
): Promise<PollOutcome> {
	const previousStage = service.stage;
	const outcome = (stage: string, terminal: boolean): PollOutcome => ({
		service,
		previousStage,
		stage,
		terminal,
	});
	const logFields = {
		conversationId: service.conversationId.toString(),
		jobId: service.jobId,
		kind: service.kind,
	};

	if (!token) {
		if (pastDeadline(service, now)) {
			logger.warn(logFields, "[mlPoller] stopping a row past its timeout with no usable token");
			await writeRow(service, stopped("past its timeout with no usable Hub token", now));
		} else {
			await writeRow(service, {
				$set: {
					nextPollAt: new Date(now.getTime() + NO_TOKEN_DELAY_MS),
					updatedAt: now,
					...(service.tokenMissingSince ? {} : { tokenMissingSince: now }),
				},
			});
		}
		return outcome(previousStage, false);
	}

	const lookup = await lookupJob({ namespace: service.namespace, jobId: service.jobId, token });

	if (lookup.state === "gone" || lookup.state === "terminal") {
		const job = lookup.state === "terminal" ? lookup.job : undefined;
		const stage = job?.stage ?? "DELETED";
		const startedAt = job?.startedAt ?? service.startedAt;
		const endedAt = job?.finishedAt ?? service.endedAt ?? now;
		await settleHold(service, lookup);
		// before the end is marked, so every path that tells it carries what landed on the hub
		const pushes = mlPushChecksEnabled()
			? await checkServicePushes({ service, startedAt, endedAt, token })
			: undefined;
		await writeRow(service, {
			$set: {
				stage,
				...(job?.message ? { stageMessage: job.message } : {}),
				...(startedAt ? { startedAt } : {}),
				endedAt,
				lastPolledAt: now,
				updatedAt: now,
				...(job ? fillFromBody(service, job) : {}),
				stageBeforeEnd: previousStage,
				...(pushes?.length ? { pushes } : {}),
				...(mlServiceEventsEnabled() ? endEventFields(service, stage, now) : {}),
			},
			$unset: {
				nextPollAt: "",
				pollFailures: "",
				tokenMissingSince: "",
				...(job?.message ? {} : { stageMessage: "" }),
				...(pushes?.length ? {} : { pushes: "" }),
			},
			...(stage !== previousStage ? historyEntry(stage, now) : {}),
		});
		logger.info(
			{
				...logFields,
				stage,
				elapsedSeconds: Math.round((endedAt.getTime() - service.createdAt.getTime()) / 1000),
				...(startedAt
					? { ranSeconds: Math.round((endedAt.getTime() - startedAt.getTime()) / 1000) }
					: {}),
			},
			"[mlPoller] service ended"
		);
		return outcome(stage, true);
	}

	if (lookup.state === "running") {
		const { job } = lookup;
		const stage = job.stage;
		// with no start from the hub the fast window runs from the first sighting
		const startedAt = job.startedAt ?? service.startedAt ?? (stage === "RUNNING" ? now : undefined);
		const delay = nextPollDelayMs({ kind: service.kind, stage, startedAt }, now);
		await writeRow(service, {
			$set: {
				stage,
				...(job.message ? { stageMessage: job.message } : {}),
				...(startedAt ? { startedAt } : {}),
				lastPolledAt: now,
				nextPollAt: new Date(now.getTime() + delay),
				updatedAt: now,
				...fillFromBody(service, job),
			},
			$unset: {
				pollFailures: "",
				tokenMissingSince: "",
				...(job.message ? {} : { stageMessage: "" }),
			},
			...(stage !== previousStage ? historyEntry(stage, now) : {}),
		});
		return outcome(stage, false);
	}

	const failures = (service.pollFailures ?? 0) + 1;
	if (failures >= MAX_POLL_FAILURES) {
		logger.warn(
			{ ...logFields, failures },
			"[mlPoller] giving up on a row after repeated failed lookups"
		);
		await writeRow(service, stopped(`${failures} consecutive failed lookups`, now));
	} else if (pastDeadline(service, now)) {
		logger.warn(logFields, "[mlPoller] stopping a row past its timeout that cannot be looked up");
		await writeRow(service, stopped("past its timeout and the last lookup failed", now));
	} else {
		await writeRow(service, {
			$set: {
				pollFailures: failures,
				nextPollAt: new Date(
					now.getTime() + backoffDelayMs(nextPollDelayMs(service, now), failures)
				),
				updatedAt: now,
			},
		});
	}
	return outcome(previousStage, false);
}

export async function pollDueServices(now = new Date()): Promise<PollOutcome[]> {
	const claimed: MlService[] = [];
	while (claimed.length < CLAIM_BATCH) {
		const service = await claimDueService(now);
		if (!service) break;
		claimed.push(service);
	}

	const tokens: TokenCache = new Map();
	const outcomes = await Promise.all(
		claimed.map(async (service) => {
			try {
				return await pollService(service, await tokenFor(service.conversationId, tokens), now);
			} catch (err) {
				logger.error(
					{ err, conversationId: service.conversationId.toString(), jobId: service.jobId },
					"[mlPoller] poll failed"
				);
				return undefined;
			}
		})
	);
	const results = outcomes.filter((o): o is PollOutcome => o !== undefined);

	const transitions = results.filter((o) => o.previousStage !== o.stage);
	for (const { service, previousStage, stage, terminal } of transitions) {
		logger.info(
			{
				conversationId: service.conversationId.toString(),
				jobId: service.jobId,
				kind: service.kind,
				from: previousStage,
				to: stage,
				terminal,
			},
			"[mlPoller] stage changed"
		);
	}
	// a reconcile that throws must not cost the tick its event delivery
	await reconcileDueSessions(tokens, now).catch((err) =>
		logger.error({ err }, "[mlReconcile] claiming a due reconcile failed")
	);
	if (mlServiceEventsEnabled()) {
		await deliverServiceEvents(await conversationsAwaitingEvents(), now);
	}
	return results;
}

async function reconcileDueSessions(tokens: TokenCache, now: Date): Promise<void> {
	for (let i = 0; i < RECONCILE_BATCH; i++) {
		const session = await claimDueReconcile(now);
		if (!session) return;
		try {
			await reconcileSession(session, await tokenFor(session._id, tokens), now);
		} catch (err) {
			logger.error(
				{ err, conversationId: session._id.toString() },
				"[mlReconcile] reconcile failed"
			);
		}
	}
}

export class MlServicePoller {
	private static instance: MlServicePoller;
	private inFlight = false;

	private constructor() {
		const interval = setInterval(() => {
			// a tick can outlive the interval since each lookup may spend its 10 s timeout,
			// claims are atomic so an overlap would only cost db round trips
			if (this.inFlight) return;
			this.inFlight = true;
			pollDueServices()
				.catch((err) => logger.error({ err }, "[mlPoller] tick failed"))
				.finally(() => {
					this.inFlight = false;
				});
		}, pollIntervalMs());
		interval.unref?.();
		onExit(() => clearInterval(interval));
	}

	public static getInstance(): MlServicePoller {
		if (!MlServicePoller.instance) {
			MlServicePoller.instance = new MlServicePoller();
		}
		return MlServicePoller.instance;
	}
}
