import { injectArtifactsPrompt } from "./artifacts";
import { ML_ASSISTANT_PREPROMPT } from "$lib/server/mlAssistant";

export interface PrepromptInput {
	/** The conversation's stored system prompt. */
	conversationPreprompt?: string;
	/** Whether this conversation runs the ML Assistant preset. */
	mlAssistant: boolean;
	/** Per-model user override for artifacts, from the model settings page. */
	artifactsOverride?: boolean;
	/** Whether the model advertises artifact support (supportsArtifacts). */
	supportsArtifacts?: boolean;
}

/**
 * The system prompt for one generation.
 *
 * Artifacts are unchanged by the preset: outside it they stay opt-in per model
 * with a per-model user override, exactly as before. The preset force-enables
 * them on top of that — it is not a gate, and a conversation that would have got
 * the artifacts prompt still gets it whether or not the mode exists.
 */
export function resolvePreprompt({
	conversationPreprompt,
	mlAssistant,
	artifactsOverride,
	supportsArtifacts,
}: PrepromptInput): string | undefined {
	const base = mlAssistant ? ML_ASSISTANT_PREPROMPT : conversationPreprompt;
	const artifacts = mlAssistant || (artifactsOverride ?? supportsArtifacts);
	return artifacts ? injectArtifactsPrompt(base) : base;
}
