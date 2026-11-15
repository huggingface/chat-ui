import type { MlService } from "$lib/types/MlService";

const SECOND = 1000;
const MINUTE = 60 * SECOND;

export const QUEUED_DELAY_MS = 15 * SECOND;
export const FRESH_RUNNING_DELAY_MS = 5 * SECOND;
export const SETTLED_RUNNING_DELAY_MS = 15 * SECOND;
export const LONG_RUNNING_DELAY_MS = 60 * SECOND;
export const SANDBOX_RUNNING_DELAY_MS = 30 * SECOND;
export const MAX_BACKOFF_MS = 5 * MINUTE;

const FRESH_RUNNING_WINDOW_MS = 10 * MINUTE;
const SETTLED_RUNNING_WINDOW_MS = 30 * MINUTE;

// the fast window is keyed to when the job started running, never to when it was
// submitted, some flavours queue for over 15 minutes
export function nextPollDelayMs(
	service: Pick<MlService, "kind" | "stage" | "startedAt">,
	now: Date
): number {
	if (service.stage !== "RUNNING") return QUEUED_DELAY_MS;
	if (service.kind === "sandbox") return SANDBOX_RUNNING_DELAY_MS;
	const runningMs = service.startedAt ? now.getTime() - service.startedAt.getTime() : 0;
	if (runningMs < FRESH_RUNNING_WINDOW_MS) return FRESH_RUNNING_DELAY_MS;
	if (runningMs < SETTLED_RUNNING_WINDOW_MS) return SETTLED_RUNNING_DELAY_MS;
	return LONG_RUNNING_DELAY_MS;
}

export function backoffDelayMs(normalMs: number, failures: number): number {
	return Math.min(MAX_BACKOFF_MS, normalMs * 2 ** Math.max(0, failures - 1));
}
