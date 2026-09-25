import type { ObjectId } from "mongodb";
import { collections } from "$lib/server/database";
import { logger } from "$lib/server/logger";
import { TERMINAL_STAGES } from "$lib/server/mlBudget/settle";
import type { MlService, ServiceEvent } from "$lib/types/MlService";
import { UNKNOWN_STAGE } from "./store";

// the wait is written before the row is cleared, so a crash in between delivers twice instead
// of never, and the copy drops an event the wait already holds

// the parking run saves every message only when it ends, a resume before that save is overwritten
const PARKED_SAVE_GRACE_MS = 15_000;

export function endEventFields(
	service: MlService,
	stage: string,
	now: Date
): Pick<MlService, "eventPendingSince" | "lastReportedStage"> {
	// a retried dispatch reopens a row the model was already told about
	if (service.lastReportedStage === stage) return {};
	// a discovered row found already over was named by the model after it ended, not news
	const seenOpen = service.stage !== UNKNOWN_STAGE && !TERMINAL_STAGES.has(service.stage);
	return service.origin === "dispatched" || seenOpen
		? { eventPendingSince: now }
		: { lastReportedStage: stage };
}

export function serviceEventFrom(service: MlService, now: Date): ServiceEvent {
	const at = service.endedAt ?? now;
	return {
		serviceId: service._id,
		kind: service.kind,
		jobId: service.jobId,
		...(service.handle ? { handle: service.handle } : {}),
		...(service.name ? { name: service.name } : {}),
		...(service.flavor ? { flavor: service.flavor } : {}),
		from: service.stageBeforeEnd ?? UNKNOWN_STAGE,
		to: service.stage,
		...(service.startedAt
			? {
					ranSeconds: Math.max(0, Math.round((at.getTime() - service.startedAt.getTime()) / 1000)),
				}
			: {}),
		at,
	};
}

const pendingFor = (conversationId: ObjectId): Promise<MlService[]> =>
	collections.mlServices.find({ conversationId, eventPendingSince: { $exists: true } }).toArray();

// matched on the exact mark, so two callers cannot both take one and a newer mark survives
const markReported = (service: MlService, now: Date) => ({
	filter: { _id: service._id, eventPendingSince: service.eventPendingSince },
	update: {
		$set: { lastReportedStage: service.stage, updatedAt: now },
		$unset: { eventPendingSince: "" as const },
	},
});

async function deliverTo(conversationId: ObjectId, now: Date): Promise<void> {
	const pending = await pendingFor(conversationId);
	if (pending.length === 0) return;
	const park = await collections.parkedCalls.findOne(
		{ conversationId, kind: "timer", status: "waiting" },
		{ sort: { createdAt: -1 }, projection: { _id: 1, parkedCallId: 1 } }
	);
	if (!park) return;

	const events = pending.map((service) => serviceEventFrom(service, now));
	const held = { $ifNull: ["$serviceEvents", []] };
	const alreadyHeld = {
		$anyElementTrue: [
			{
				$map: {
					input: held,
					as: "seen",
					in: {
						$and: [
							{ $eq: ["$$seen.serviceId", "$$event.serviceId"] },
							{ $eq: ["$$seen.to", "$$event.to"] },
						],
					},
				},
			},
		],
	};
	const wakeAt = { $max: [now, { $add: ["$createdAt", PARKED_SAVE_GRACE_MS] }] };
	// a wait already due is not cut short, it only carries the events
	const early = { $gt: ["$resumeAt", wakeAt] };
	const delivered = await collections.parkedCalls.updateOne({ _id: park._id, status: "waiting" }, [
		{
			$set: {
				serviceEvents: {
					$concatArrays: [
						held,
						{
							$filter: {
								// literal, a model written job name starting with $ would read as a field path
								input: { $literal: events },
								as: "event",
								cond: { $not: [alreadyHeld] },
							},
						},
					],
				},
				plannedResumeAt: {
					$cond: [early, { $ifNull: ["$plannedResumeAt", "$resumeAt"] }, "$plannedResumeAt"],
				},
				wokeByHarnessAt: { $cond: [early, now, "$wokeByHarnessAt"] },
				resumeAt: { $min: ["$resumeAt", wakeAt] },
				updatedAt: now,
			},
		},
	]);
	// a sweeper claimed it first, the events stay pending
	if (delivered.matchedCount === 0) return;

	await collections.mlServices.bulkWrite(
		pending.map((service) => ({ updateOne: markReported(service, now) }))
	);
	logger.info(
		{
			conversationId: conversationId.toString(),
			parkedCallId: park.parkedCallId,
			events: events.map(({ jobId, kind, to }) => ({ jobId, kind, to })),
		},
		"[mlEvents] delivered into a parked wait"
	);
}

// an ended row is never polled again, so every tick looks here to retry a failed delivery or
// reach a wait that parked after the mark
export async function conversationsAwaitingEvents(): Promise<ObjectId[]> {
	const parked = await collections.parkedCalls.distinct("conversationId", {
		kind: "timer",
		status: "waiting",
	});
	if (parked.length === 0) return [];
	return collections.mlServices.distinct("conversationId", {
		conversationId: { $in: parked },
		eventPendingSince: { $exists: true },
	});
}

export async function deliverServiceEvents(
	conversationIds: ObjectId[],
	now = new Date()
): Promise<void> {
	const unique = new Map(conversationIds.map((id) => [id.toString(), id]));
	for (const conversationId of unique.values()) {
		try {
			await deliverTo(conversationId, now);
		} catch (err) {
			logger.error(
				{ err, conversationId: conversationId.toString() },
				"[mlEvents] delivery into a parked wait failed"
			);
		}
	}
}

/** for a wait about to park, a crash after the claim loses the line, an ended job is listed once */
export async function claimServiceEvents(
	conversationId: ObjectId,
	now = new Date()
): Promise<ServiceEvent[]> {
	const claimed: ServiceEvent[] = [];
	for (const service of await pendingFor(conversationId)) {
		const { filter, update } = markReported(service, now);
		const { modifiedCount } = await collections.mlServices.updateOne(filter, update);
		if (modifiedCount === 1) claimed.push(serviceEventFrom(service, now));
	}
	return claimed;
}
