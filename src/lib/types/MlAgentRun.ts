import type { ObjectId } from "mongodb";
import type { Conversation } from "./Conversation";
import type { Message } from "./Message";

export type MlAgentRunStatus = "running" | "completed" | "failed" | "aborted";

/** the exit a failed run took, internal_error is a throw out of the loop */
export type MlAgentRunFailure =
	| "no_tools"
	| "context_limit"
	| "iteration_limit"
	| "no_summary"
	| "rate_limited"
	| "llm_error"
	| "internal_error";

export interface MlAgentRunCall {
	tool: string;
	/** redacted and cut */
	args: string;
	status: "success" | "error";
	/** redacted and cut */
	error?: string;
}

/**
 * one sub-agent run, research, sandbox_task or check_job, the durable record the pane reads
 * its own collection and not mlServices, the poller would claim a row there and look it up as a hub job
 */
export interface MlAgentRun {
	_id: ObjectId;
	conversationId: Conversation["_id"];
	/** research, sandbox, job-check */
	label: string;
	displayName: string;
	/** cut in the middle when long */
	task: string;
	parent: {
		/** the builtin the model called */
		tool: string;
		/** the dispatch uuid of that call */
		toolUuid: string;
		messageId?: Message["id"];
		generationId?: string;
	};
	status: MlAgentRunStatus;
	failure?: MlAgentRunFailure;
	/** the limit that forced the summary a completed run returned */
	forcedBy?: "context_limit" | "iteration_limit";
	/** what the parent was told when the run did not complete, cut */
	error?: string;
	startedAt: Date;
	endedAt?: Date;
	/** model requests made with tools offered */
	iterations: number;
	/** the first calls only, capped */
	calls: MlAgentRunCall[];
	/** every call made, the kept ones and any past the cap */
	callCount: number;
	/** what the parent read back, cut */
	summary?: string;
	/** sources this run read or found, counted when it ended */
	sourceCount: number;
}
