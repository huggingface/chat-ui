import { randomUUID } from "crypto";
import { logger } from "$lib/server/logger";

export type ApprovalDecision = "allow" | "deny" | "always";

interface PendingApproval {
	resolve: (decision: ApprovalDecision) => void;
	reject: (reason: Error) => void;
	userKey: string;
	createdAt: number;
	onAbort?: () => void;
	abortSignal?: AbortSignal;
	timer?: ReturnType<typeof setTimeout>;
}

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

// NOTE: This assumes a single Node process. Multi-instance deployments would
// need Redis pub/sub or sticky sessions.
const pending = new Map<string, PendingApproval>();

function approvalTimeoutMs(): number {
	const raw = process.env.MCP_APPROVAL_TIMEOUT_MS;
	const parsed = raw ? Number(raw) : NaN;
	if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_TIMEOUT_MS;
	return parsed;
}

function cleanup(id: string) {
	const entry = pending.get(id);
	if (!entry) return;
	if (entry.timer) clearTimeout(entry.timer);
	if (entry.abortSignal && entry.onAbort) {
		entry.abortSignal.removeEventListener("abort", entry.onAbort);
	}
	pending.delete(id);
}

export function createApproval(
	userKey: string,
	abortSignal?: AbortSignal
): { id: string; promise: Promise<ApprovalDecision> } {
	const id = randomUUID();

	const promise = new Promise<ApprovalDecision>((resolve, reject) => {
		const entry: PendingApproval = {
			resolve,
			reject,
			userKey,
			createdAt: Date.now(),
			abortSignal,
		};

		if (abortSignal) {
			if (abortSignal.aborted) {
				reject(new Error("aborted"));
				return;
			}
			entry.onAbort = () => {
				cleanup(id);
				reject(new Error("aborted"));
			};
			abortSignal.addEventListener("abort", entry.onAbort, { once: true });
		}

		entry.timer = setTimeout(() => {
			cleanup(id);
			reject(new Error("timeout"));
		}, approvalTimeoutMs());

		pending.set(id, entry);
	});

	return { id, promise };
}

export function resolveApproval(
	id: string,
	decision: ApprovalDecision,
	userKey: string
): "ok" | "not_found" | "forbidden" {
	const entry = pending.get(id);
	if (!entry) return "not_found";
	if (entry.userKey !== userKey) {
		logger.warn({ id }, "[mcp] approval userKey mismatch");
		return "forbidden";
	}
	entry.resolve(decision);
	cleanup(id);
	return "ok";
}

export function rejectApproval(id: string, reason: string) {
	const entry = pending.get(id);
	if (!entry) return;
	entry.reject(new Error(reason));
	cleanup(id);
}
