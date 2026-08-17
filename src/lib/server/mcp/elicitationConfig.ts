import { config } from "$lib/server/config";

const DEFAULT_TIMEOUT_MS = 60 * 60_000;

/**
 * Separate from `elicitation.ts` so `client.ts` can decide whether to declare the
 * capability without pulling the database in behind it.
 */
export function isElicitationEnabled(): boolean {
	return config.MCP_DISABLE_ELICITATION !== "true";
}

/**
 * How long a prompt stays answerable. Independent of `MCP_TOOL_TIMEOUT_MS`: the tool
 * call's own deadline is stopped while the prompt is open (see `createCallDeadline`), so
 * this is the only thing bounding how long a user has.
 *
 * Long enough to be no real limit for someone who walked away, because in practice the
 * server's own timeout on the request it sent us decides first (60s by MCP SDK default,
 * and its cancellation closes the prompt). What this actually bounds is a run nobody ever
 * answers and nobody stops: the heartbeat beats regardless of what a generation is doing,
 * so without an expiry it would stay `running` — holding its pooled client — forever.
 */
export function getElicitationTimeoutMs(): number {
	const raw = config.MCP_ELICITATION_TIMEOUT_MS;
	if (raw) {
		const parsed = parseInt(raw, 10);
		if (!isNaN(parsed) && parsed > 0) return parsed;
	}
	return DEFAULT_TIMEOUT_MS;
}
