/**
 * the reply text is a weak fallback for the structured part, unless the call detaches the
 * server tails the job log into that text so a match there may be reading what the job printed
 */

export interface JobRef {
	jobId: string;
	namespace?: string;
}

export type SubmissionKind = "job" | "sandbox";

const JOB_ID_PATTERN = /^[0-9a-f]{24}$/;
const NAMESPACE_PATTERN = /^[A-Za-z0-9][\w.-]*$/;

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
	typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;

const matching = (value: unknown, pattern: RegExp): string | undefined =>
	typeof value === "string" && pattern.test(value) ? value : undefined;

function submissionFields(
	kind: SubmissionKind,
	structured: unknown
): { id: unknown; namespace: unknown } {
	const root = asRecord(structured);
	if (kind === "sandbox") return { id: root?.job_id, namespace: root?.namespace };
	const job = asRecord(asRecord(root?.outcome)?.job);
	return { id: job?.id, namespace: asRecord(job?.owner)?.name };
}

/** a bad namespace is dropped rather than failing the read, callers have one to fall back on */
export function jobRefFromStructured(
	kind: SubmissionKind,
	structured: unknown
): JobRef | undefined {
	const fields = submissionFields(kind, structured);
	const jobId = matching(fields.id, JOB_ID_PATTERN);
	if (!jobId) return undefined;
	const namespace = matching(fields.namespace, NAMESPACE_PATTERN);
	return { jobId, ...(namespace ? { namespace } : {}) };
}

/** usage help comes back as a success result, the status alone cannot tell it from a launch */
export function isHelpReply(structured: unknown): boolean {
	return asRecord(asRecord(structured)?.outcome)?.kind === "help";
}

/** `huggingface.co/jobs/<namespace>/<id>` in a submission response. */
const JOB_URL_PATTERN = /huggingface\.co\/jobs\/([A-Za-z0-9][\w.-]*)\/([0-9a-f]{24})/;
/** `hfsb2:<namespace>:<job id>` — the sandbox handle format. */
const SANDBOX_HANDLE_PATTERN = /hfsb2:([\w.-]+):([0-9a-f]{24})/;
/** Last resort: any 24-hex id in the response, namespace taken from the args or the user. */
const BARE_JOB_ID_PATTERN = /\b([0-9a-f]{24})\b/;

export function jobRefFromText(text: string, fallbackNamespace?: string): JobRef | undefined {
	const url = JOB_URL_PATTERN.exec(text);
	if (url) return { namespace: url[1], jobId: url[2] };
	const handle = SANDBOX_HANDLE_PATTERN.exec(text);
	if (handle) return { namespace: handle[1], jobId: handle[2] };
	const bare = BARE_JOB_ID_PATTERN.exec(text);
	if (bare) {
		return { jobId: bare[1], ...(fallbackNamespace ? { namespace: fallbackNamespace } : {}) };
	}
	return undefined;
}
