import type { GuardVerdict, ToolCallGuard } from "../mcp/toolGuard";

/**
 * Confines a delegated `hf_jobs` to the operations that only read.
 *
 * The nested-agent invariant is that a sub-agent's allowlist holds nothing that
 * spends or creates, because its calls bypass the parent's budget gate. But
 * `hf_jobs` is a single tool whose `operation` argument decides between reading
 * a run and submitting one, so a name-based allowlist cannot express "logs but
 * not uv". This does it at the argument level instead, and it is what lets the
 * watcher exist at all.
 *
 * Fail-closed: an operation that is absent, malformed, or simply not on the
 * list is refused. A new spending operation added upstream is therefore refused
 * by default rather than silently permitted.
 */
const READ_ONLY_OPERATIONS: ReadonlySet<string> = new Set([
	"logs",
	"inspect",
	"ps",
	"scheduled ps",
	"scheduled inspect",
]);

/** Names the operations so the sub-agent can correct itself rather than retry blindly. */
const ALLOWED_LIST = [...READ_ONLY_OPERATIONS].map((op) => `'${op}'`).join(", ");

export function createReadOnlyJobsGuard(toolName: string): ToolCallGuard {
	return {
		// Nothing is booked, so nothing needs releasing and a refusal costs nothing.
		allowParking: true,
		async before(call): Promise<GuardVerdict> {
			if (call.fnName !== toolName) return { allow: true };
			const operation = call.args?.operation;
			if (typeof operation === "string" && READ_ONLY_OPERATIONS.has(operation)) {
				return { allow: true };
			}
			const named = typeof operation === "string" ? `'${operation}'` : "no operation";
			return {
				allow: false,
				message:
					`Refused: ${named} is not readable from here. This sub-agent may only read a job — ` +
					`${ALLOWED_LIST} — and cannot submit, cancel or schedule one. ` +
					`Report what the logs show and let the caller decide what to run.`,
			};
		},
		async after() {
			return undefined;
		},
	};
}
