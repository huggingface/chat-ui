import { config } from "$lib/server/config";

const DEFAULT_TIMEOUT_MS = 60 * 60_000;

/** Split from `elicitation.ts` so `client.ts` can read it without pulling in the database. */
export function isElicitationEnabled(): boolean {
	return config.MCP_DISABLE_ELICITATION !== "true";
}

/** Bounds a run nobody answers and nobody stops, which would otherwise never finish. */
export function getElicitationTimeoutMs(): number {
	const raw = config.MCP_ELICITATION_TIMEOUT_MS;
	if (raw) {
		const parsed = parseInt(raw, 10);
		if (!isNaN(parsed) && parsed > 0) return parsed;
	}
	return DEFAULT_TIMEOUT_MS;
}
