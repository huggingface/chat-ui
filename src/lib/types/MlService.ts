import type { ObjectId } from "mongodb";
import type { Conversation } from "./Conversation";
import type { Message } from "./Message";
import type { MlFileRef } from "./MlFile";
import type { Timestamps } from "./Timestamps";

export type MlServiceKind = "job" | "sandbox";

/**
 * dispatched means the harness read the id from the reply of the call that created it
 * discovered means the id only ever appeared in the arguments of a later call, nothing is verified
 */
export type MlRegistryOrigin = "dispatched" | "discovered";

/**
 * owned by the conversation, not a branch, editing an earlier message does not un-launch a job
 * its own collection because a poller asks which services are due across every conversation
 */
export interface MlService extends Timestamps {
	_id: ObjectId;
	conversationId: Conversation["_id"];
	kind: MlServiceKind;
	/** 24 hex, a sandbox is a job too so it has one */
	jobId: string;
	namespace: string;
	/** hfsb2:<namespace>:<jobId>, sandboxes only */
	handle?: string;
	/** the hub mcp server drops it, so the arguments are the only place it survives */
	name?: string;
	/** the virtual file versions the submission was expanded from */
	scriptRefs?: MlFileRef[];
	flavor?: string;
	timeoutSeconds?: number;
	/** the hub stage as returned, SCHEDULING RUNNING COMPLETED CANCELED ERROR DELETED, or UNKNOWN */
	stage: string;
	stageMessage?: string;
	origin: MlRegistryOrigin;
	startedAt?: Date;
	endedAt?: Date;
	/** poller bookkeeping, a row with no nextPollAt is finished, stopped or waiting for a token */
	lastPolledAt?: Date;
	nextPollAt?: Date;
	/** one entry per stage change the poller saw, newest last, capped */
	stageHistory?: { stage: string; at: Date }[];
	/** consecutive failed lookups, cleared by a successful one */
	pollFailures?: number;
	/** set when the poller gave the row up for good */
	pollStoppedReason?: string;
	/** since when no usable hub token could be found for the conversation, cleared on the next poll */
	tokenMissingSince?: Date;
	/** the stage the model was last told about, written by the event path, never by the poller */
	lastReportedStage?: string;
	/** the budget reservation key, generationId:callUuid */
	reservationKey?: string;
	hubUrl: string;
	messageId?: Message["id"];
	generationId?: string;
	/** the dispatch uuid, not the provider tool call id */
	toolUuid?: string;
}
