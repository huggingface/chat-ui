import type { ObjectId } from "mongodb";
import { collections } from "$lib/server/database";
import type { MlArtefact, MlArtefactKind } from "$lib/types/MlArtefact";
import type { MlService, MlServiceKind } from "$lib/types/MlService";

// every write is an upsert keyed on the external id, so a retried round or a discovery racing a
// dispatch converge on one row

export const UNKNOWN_STAGE = "UNKNOWN";

/** what a row the poller gave up on was reported as, never a stage the hub returns */
export const UNTRACKED_STAGE = "UNTRACKED";

export const hubJobUrl = (namespace: string, jobId: string): string =>
	`https://huggingface.co/jobs/${namespace}/${jobId}`;

export const sandboxHandle = (namespace: string, jobId: string): string =>
	`hfsb2:${namespace}:${jobId}`;

interface Provenance {
	messageId?: string;
	generationId?: string;
	toolUuid?: string;
}

/** the driver stores undefined as null */
const compact = <T extends Record<string, unknown>>(record: T): Partial<T> =>
	Object.fromEntries(Object.entries(record).filter(([, v]) => v !== undefined)) as Partial<T>;

export interface DispatchedService extends Provenance {
	conversationId: ObjectId;
	kind: MlServiceKind;
	jobId: string;
	namespace: string;
	stage: string;
	stageMessage?: string;
	handle?: string;
	name?: string;
	flavor?: string;
	timeoutSeconds?: number;
	/** defaults to the job page */
	hubUrl?: string;
	reservationKey?: string;
}

/** what the reply said overrides whatever was there */
export async function recordDispatchedService(service: DispatchedService): Promise<void> {
	const now = new Date();
	const { conversationId, kind, jobId, namespace, hubUrl, ...rest } = service;
	await collections.mlServices.updateOne(
		{ conversationId, kind, jobId },
		{
			$setOnInsert: { createdAt: now, nextPollAt: now },
			$set: {
				...compact(rest),
				namespace,
				hubUrl: hubUrl ?? hubJobUrl(namespace, jobId),
				origin: "dispatched",
				updatedAt: now,
			},
		},
		{ upsert: true }
	);
}

/** insert only, keyed on the job id alone so a sandbox read via hf_jobs gets no job twin */
export async function recordDiscoveredService({
	conversationId,
	kind,
	jobId,
	namespace,
	handle,
}: {
	conversationId: ObjectId;
	kind: MlServiceKind;
	jobId: string;
	namespace: string;
	handle?: string;
}): Promise<void> {
	const now = new Date();
	await collections.mlServices.updateOne(
		{ conversationId, jobId },
		{
			$setOnInsert: {
				kind,
				namespace,
				...(handle ? { handle } : {}),
				stage: UNKNOWN_STAGE,
				origin: "discovered",
				hubUrl: hubJobUrl(namespace, jobId),
				createdAt: now,
				updatedAt: now,
				nextPollAt: now,
			},
		},
		{ upsert: true }
	);
}

export interface ArtefactRecord extends Provenance {
	conversationId: ObjectId;
	kind: MlArtefactKind;
	uri: string;
	url: string;
	commit?: string;
	serviceId?: ObjectId;
}

/** a repeat write moves the commit, or clears it when the reply named none, who first made it stays */
export async function recordArtefact(artefact: ArtefactRecord): Promise<void> {
	const now = new Date();
	const { conversationId, uri, kind, url, commit, serviceId, messageId, generationId, toolUuid } =
		artefact;
	await collections.mlArtefacts.updateOne(
		{ conversationId, uri },
		{
			$setOnInsert: { createdAt: now, ...compact({ messageId, generationId, toolUuid }) },
			$set: {
				kind,
				url,
				origin: "dispatched",
				updatedAt: now,
				...compact({ commit, serviceId }),
			},
			...(commit ? {} : { $unset: { commit: "" } }),
		},
		{ upsert: true }
	);
}

/** the parent of a written file, inserted as discovered if absent */
export async function ensureArtefact({
	conversationId,
	kind,
	uri,
	url,
}: {
	conversationId: ObjectId;
	kind: MlArtefactKind;
	uri: string;
	url: string;
}): Promise<void> {
	const now = new Date();
	await collections.mlArtefacts.updateOne(
		{ conversationId, uri },
		{ $setOnInsert: { kind, url, origin: "discovered", createdAt: now, updatedAt: now } },
		{ upsert: true }
	);
}

export function recordDashboardArtefact({
	conversationId,
	spaceId,
	...provenance
}: Provenance & { conversationId: ObjectId; spaceId: string }): Promise<void> {
	return recordArtefact({
		conversationId,
		kind: "dashboard",
		uri: `hf://spaces/${spaceId}`,
		url: `https://huggingface.co/spaces/${spaceId}`,
		...provenance,
	});
}

/** the rows have no ttl, so a deleted conversation takes them with it */
export async function deleteMlRegistry(conversationIds: ObjectId[]): Promise<void> {
	if (conversationIds.length === 0) return;
	const filter = { conversationId: { $in: conversationIds } };
	await Promise.all([
		collections.mlServices.deleteMany(filter),
		collections.mlArtefacts.deleteMany(filter),
	]);
}

export interface ServiceReport {
	_id: ObjectId;
	/** the stage the row had when it was read, a row that moved on since is not marked */
	stage: string;
	/** the stage, or UNTRACKED_STAGE for a row the poller gave up on */
	reported: string;
}

/** every path that tells the model about an ended row records it here so it is told once */
export async function markServicesReported(reports: readonly ServiceReport[]): Promise<void> {
	if (reports.length === 0) return;
	await collections.mlServices.bulkWrite(
		reports.map(({ _id, stage, reported }) => ({
			updateOne: {
				filter: { _id, stage },
				// an event still pending would tell the model a second time from a parked wait
				update: {
					$set: { lastReportedStage: reported },
					$unset: { eventPendingSince: "" as const },
				},
			},
		})),
		{ ordered: false }
	);
}

export function listMlServices(conversationId: ObjectId): Promise<MlService[]> {
	return collections.mlServices.find({ conversationId }).sort({ createdAt: 1, _id: 1 }).toArray();
}

export function listMlArtefacts(conversationId: ObjectId): Promise<MlArtefact[]> {
	return collections.mlArtefacts.find({ conversationId }).sort({ createdAt: 1, _id: 1 }).toArray();
}
