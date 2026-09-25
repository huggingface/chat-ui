import type { MlArtefact } from "./MlArtefact";
import type { MlFileListing } from "./MlFile";
import type { MlService } from "./MlService";

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

export interface MlRegistryPayload {
	services: MlRegistryService[];
	artefacts: MlRegistryArtefact[];
	files: MlFileListing[];
	/** the server clock when it answered, epoch ms, for skew corrected elapsed times */
	serverNow: number;
}

/** what the strip control needs, counted once in the store */
export interface MlRegistrySummary {
	/** services and artefacts, the control hides at zero, files join once the pane lists them */
	rows: number;
	/** services the Hub would still bill */
	open: number;
	/** services at the RUNNING stage */
	running: number;
}
