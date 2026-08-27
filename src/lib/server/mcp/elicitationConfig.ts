import { config } from "$lib/server/config";

const DEFAULT_TIMEOUT_MS = 60 * 60_000;

/** Split from `elicitation.ts` so `client.ts` can read it without pulling in the database. */
export function isElicitationEnabled(): boolean {
	return config.MCP_DISABLE_ELICITATION !== "true";
}

/**
 * On a 2026-era connection this is the only thing bounding a prompt: the server answered
 * with `input_required` and is no longer waiting on anything.
 */
export function getElicitationTimeoutMs(): number {
	const raw = config.MCP_ELICITATION_TIMEOUT_MS;
	if (raw) {
		const parsed = parseInt(raw, 10);
		if (!isNaN(parsed) && parsed > 0) return parsed;
	}
	return DEFAULT_TIMEOUT_MS;
}
