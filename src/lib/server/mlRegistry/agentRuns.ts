import { ObjectId } from "mongodb";
import { collections } from "$lib/server/database";
import { logger } from "$lib/server/logger";
import { redactSecrets } from "$lib/utils/redactSecrets";
import type {
	MlAgentRun,
	MlAgentRunCall,
	MlAgentRunFailure,
	MlAgentRunStatus,
} from "$lib/types/MlAgentRun";
import { countSourcesReadBy } from "./sources";

export const AGENT_RUN_TASK_MAX = 2_000;
export const AGENT_RUN_SUMMARY_MAX = 8_000;
export const AGENT_RUN_CALLS_MAX = 200;
const CALL_TEXT_MAX = 200;
const ERROR_MAX = 200;

const cut = (text: string, max: number): string =>
	text.length > max ? `${text.slice(0, max)}…` : text;

// a task is its context then what to do, so a long one loses its middle and keeps both ends
const cutMiddle = (text: string, max: number): string => {
	if (text.length <= max) return text;
	const head = Math.ceil(max / 2);
	return `${text.slice(0, head)}\n…\n${text.slice(text.length - (max - head))}`;
};

/** what a call keeps, redacted before it is cut so a secret on the boundary is not half kept */
export function toRunCall(call: {
	tool: string;
	args: string;
	status: "success" | "error";
	error?: string;
}): MlAgentRunCall {
	return {
		tool: call.tool,
		args: cut(redactSecrets(call.args), CALL_TEXT_MAX),
		status: call.status,
		...(call.error !== undefined ? { error: cut(redactSecrets(call.error), CALL_TEXT_MAX) } : {}),
	};
}

export type AgentRunEnd =
	| { status: "completed"; summary: string; forcedBy?: MlAgentRun["forcedBy"] }
	| { status: "failed"; failure: MlAgentRunFailure; error: string }
	| { status: "aborted"; error?: string };

export interface AgentRunRecorder {
	/** what sources and call log rows name the run by */
	readonly id: string;
	round(iterations: number, calls: MlAgentRunCall[]): void;
	finish(end: AgentRunEnd & { iterations: number }): Promise<void>;
}

/**
 * one row per sub-agent run, its writes run in order so an update never lands before the insert
 * and none of them throws into the run
 */
export function startAgentRun(start: {
	conversationId: ObjectId;
	label: string;
	displayName: string;
	task: string;
	parent: MlAgentRun["parent"];
}): AgentRunRecorder {
	const _id = new ObjectId();
	const { conversationId } = start;
	let chain: Promise<void> = Promise.resolve();
	const enqueue = (what: string, write: () => Promise<unknown>) => {
		chain = chain.then(async () => {
			try {
				await write();
			} catch (err) {
				logger.error(
					{ err: String(err), conversationId: conversationId.toString(), run: _id.toString() },
					`[mlRegistry] ${what} of a sub-agent run failed`
				);
			}
		});
	};

	enqueue("the insert", () =>
		collections.mlAgentRuns.insertOne({
			_id,
			conversationId,
			label: start.label,
			displayName: start.displayName,
			task: cutMiddle(start.task, AGENT_RUN_TASK_MAX),
			parent: start.parent,
			status: "running",
			startedAt: new Date(),
			iterations: 0,
			calls: [],
			callCount: 0,
			sourceCount: 0,
		})
	);

	return {
		id: _id.toString(),

		round(iterations, calls) {
			enqueue("a round", () =>
				collections.mlAgentRuns.updateOne(
					{ _id },
					{
						$max: { iterations },
						...(calls.length
							? {
									$push: { calls: { $each: calls, $slice: AGENT_RUN_CALLS_MAX } },
									$inc: { callCount: calls.length },
								}
							: {}),
					}
				)
			);
		},

		async finish(end) {
			enqueue("the end", async () => {
				const sourceCount = await countSourcesReadBy(conversationId, _id.toString());
				const status: MlAgentRunStatus = end.status;
				await collections.mlAgentRuns.updateOne(
					{ _id },
					{
						$max: { iterations: end.iterations },
						$set: {
							status,
							endedAt: new Date(),
							sourceCount,
							...(end.status === "completed"
								? {
										summary: cut(end.summary, AGENT_RUN_SUMMARY_MAX),
										...(end.forcedBy ? { forcedBy: end.forcedBy } : {}),
									}
								: {}),
							...(end.status === "failed" ? { failure: end.failure } : {}),
							...(end.status !== "completed" && end.error
								? { error: cut(redactSecrets(end.error), ERROR_MAX) }
								: {}),
						},
					}
				);
			});
			await chain;
		},
	};
}

/** the runs a dead generation left running, called once that generation is marked interrupted */
export async function interruptAgentRuns(
	conversationId: ObjectId,
	generationId: string
): Promise<void> {
	await collections.mlAgentRuns.updateMany(
		{ conversationId, "parent.generationId": generationId, status: "running" },
		{ $set: { status: "interrupted", endedAt: new Date() } }
	);
}

// sandbox and job-check runs only spare the parent context, they are recorded but not listed
const LISTED_LABELS = ["research"];

/** the listed rows without their calls and summary, the pane asks for those one run at a time */
export function listMlAgentRuns(
	conversationId: ObjectId
): Promise<Omit<MlAgentRun, "calls" | "summary">[]> {
	return collections.mlAgentRuns
		.find(
			{ conversationId, label: { $in: LISTED_LABELS } },
			{ projection: { calls: 0, summary: 0 } }
		)
		.sort({ startedAt: 1, _id: 1 })
		.toArray();
}

export function readMlAgentRun(
	conversationId: ObjectId,
	runId: ObjectId
): Promise<MlAgentRun | null> {
	return collections.mlAgentRuns.findOne({ _id: runId, conversationId });
}
