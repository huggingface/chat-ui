import type { ReasoningEffort } from "$lib/types/Settings";

/**
 * Some providers reject `medium`/`high` even when their model is reasoning-capable.
 * Currently Cohere's `command-a-reasoning` only accepts `low` (others 422).
 *
 * On the HF router the resolved provider may be "auto"/undefined when the user has
 * no override, so we also clamp by model id for the only Cohere reasoning model.
 */
const COHERE_LOW_ONLY_MODELS = new Set([
	"CohereLabs/command-a-reasoning-08-2025",
	"command-a-reasoning-08-2025",
]);

export function cohereSafeEffort(
	provider: string | undefined,
	effort: ReasoningEffort,
	modelId?: string
): ReasoningEffort {
	if (provider === "cohere") return "low";
	if (modelId && COHERE_LOW_ONLY_MODELS.has(modelId)) return "low";
	return effort;
}
