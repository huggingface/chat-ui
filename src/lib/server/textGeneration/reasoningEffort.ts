import type { ReasoningEffort } from "$lib/types/Settings";

/**
 * Some providers reject `medium`/`high` even when their model is reasoning-capable.
 * Currently Cohere's `command-a-reasoning` only accepts `low` (others 422).
 */
export function cohereSafeEffort(
	provider: string | undefined,
	effort: ReasoningEffort
): ReasoningEffort {
	if (provider === "cohere") return "low";
	return effort;
}
