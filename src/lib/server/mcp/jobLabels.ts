import { isHfMcpServer } from "./hf";
import type { ToolArgsRewrite } from "$lib/server/textGeneration/mcp/toolInvocation";

export const SESSION_LABEL_KEY = "ml-intern-session";
export const JOB_NAME_PREFIX = "ml-intern-";
/** the jobs api limit on a label key or value */
const LABEL_MAX_LENGTH = 100;

export interface SessionJobLabels {
	session: string;
	/** jobs this conversation launched, with the name each was last given */
	ownJobs: Map<string, string | undefined>;
}

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
	typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
const asString = (value: unknown): string | undefined =>
	typeof value === "string" && value.length > 0 ? value : undefined;

export const prefixedJobName = (name: string): string =>
	(name.startsWith(JOB_NAME_PREFIX) ? name : `${JOB_NAME_PREFIX}${name}`).slice(
		0,
		LABEL_MAX_LENGTH
	);

function withSessionLabels(
	args: Record<string, unknown>,
	session: string,
	keptName?: string
): Record<string, unknown> {
	// not an object fails the tool schema, the preflight says so
	const inner = args.args === undefined ? {} : asRecord(args.args);
	if (!inner) return args;
	const labels = inner.labels === undefined ? {} : asRecord(inner.labels);
	if (!labels) return args;
	// name is an alias for labels.name and the server rejects both, so it travels in labels
	const name = asString(inner.name) ?? asString(labels.name) ?? keptName;
	const rewritten: Record<string, unknown> = { ...inner };
	if (asString(inner.name)) delete rewritten.name;
	rewritten.labels = {
		...labels,
		...(name ? { name: prefixedJobName(name) } : {}),
		[SESSION_LABEL_KEY]: session,
	};
	return { ...args, args: rewritten };
}

export function createJobLabelRewrite({ session, ownJobs }: SessionJobLabels): ToolArgsRewrite {
	return ({ serverUrl, tool, args }) => {
		// never hf_sandbox, one of the labels the server sets on a sandbox is part of its auth
		if (!isHfMcpServer(serverUrl) || tool !== "hf_jobs") return args;
		if (args.operation === "run" || args.operation === "uv") {
			return withSessionLabels(args, session);
		}
		// update-labels replaces the set, so a model adding one label would drop ours with it
		if (args.operation === "update-labels") {
			const jobId = asString(asRecord(args.args)?.job_id);
			if (!jobId || !ownJobs.has(jobId) || asRecord(args.args)?.labels === undefined) return args;
			return withSessionLabels(args, session, ownJobs.get(jobId));
		}
		return args;
	};
}
