import type { MlAgentRun } from "./MlAgentRun";
import type { MlArtefact } from "./MlArtefact";
import type { MlFileListing } from "./MlFile";
import type { MlService } from "./MlService";
import type { MlSource } from "./MlSource";

/**
 * what GET /api/v2/conversations/[id]/registry returns, the rows with string ids and the
 * budget ledger already joined so the client never needs the reservations
 */
export interface MlRegistryService extends Omit<MlService, "_id" | "conversationId"> {
	id: string;
	/** ceiling of the reservation still open for it, absent once settled or released */
	heldMicroUsd?: number;
	/** the poller sets it once the Hub could no longer be asked, nothing writes it before then */
	tokenMissingSince?: Date;
}

export interface MlRegistryArtefact extends Omit<
	MlArtefact,
	"_id" | "conversationId" | "serviceId"
> {
	id: string;
	serviceId?: string;
}

/** a run without its calls and summary, the run endpoint serves those one run at a time */
export interface MlRegistryAgentRun extends Omit<
	MlAgentRun,
	"_id" | "conversationId" | "task" | "calls" | "summary"
> {
	id: string;
	/** the start of the task, the whole of it comes with the calls */
	taskPreview: string;
}

/** what GET /api/v2/conversations/[id]/runs/[runId] returns */
export interface MlAgentRunDetail extends Omit<MlAgentRun, "_id" | "conversationId"> {
	id: string;
}

export interface MlRegistrySource extends Omit<MlSource, "_id" | "conversationId"> {
	id: string;
}

export interface MlRegistryPayload {
	services: MlRegistryService[];
	/** absent from a server that predates runs and sources, which a rolling deploy can still answer from */
	agentRuns?: MlRegistryAgentRun[];
	artefacts: MlRegistryArtefact[];
	files: MlFileListing[];
	sources?: MlRegistrySource[];
	/** the server clock when it answered, epoch ms, for skew corrected elapsed times */
	serverNow: number;
}

/** what the strip control needs, counted once in the store */
export interface MlRegistrySummary {
	/** services, sub-agent runs, artefacts, files and sources, the control hides at zero */
	rows: number;
	/** services the Hub would still bill */
	open: number;
	/** services at the RUNNING stage */
	running: number;
}
