import type { ObjectId } from "mongodb";
import type { Conversation } from "./Conversation";
import type { Message } from "./Message";
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
	flavor?: string;
	timeoutSeconds?: number;
	/** the hub stage as returned, SCHEDULING RUNNING COMPLETED CANCELED ERROR DELETED, or UNKNOWN */
	stage: string;
	stageMessage?: string;
	origin: MlRegistryOrigin;
	startedAt?: Date;
	endedAt?: Date;
	/** poller bookkeeping, declared now so the poller adds no migration */
	lastPolledAt?: Date;
	nextPollAt?: Date;
	/** the budget reservation key, generationId:callUuid */
	reservationKey?: string;
	hubUrl: string;
	messageId?: Message["id"];
	generationId?: string;
	/** the dispatch uuid, not the provider tool call id */
	toolUuid?: string;
}
