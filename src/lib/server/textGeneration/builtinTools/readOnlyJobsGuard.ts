import type { GuardVerdict, ToolCallGuard } from "../mcp/toolGuard";

/**
 * Confines a delegated `hf_jobs` to its reading operations.
 *
 * A sub-agent's allowlist is by tool name, and `hf_jobs` decides between
 * reading a run and submitting one on an argument — so the restriction has to
 * live here. Fail-closed, so an operation added upstream is refused by default.
 */
const READ_ONLY_OPERATIONS: ReadonlySet<string> = new Set([
	"logs",
	"inspect",
	"ps",
	"scheduled ps",
	"scheduled inspect",
]);

const ALLOWED_LIST = [...READ_ONLY_OPERATIONS].map((op) => `'${op}'`).join(", ");

export function createReadOnlyJobsGuard(toolName: string): ToolCallGuard {
	return {
		// Books nothing, so nothing needs releasing.
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
