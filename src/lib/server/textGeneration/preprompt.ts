import { injectArtifactsPrompt } from "./artifacts";
import { ML_ASSISTANT_PREPROMPT, mlAssistantSessionContext } from "$lib/server/mlAssistantPrompt";

export interface PrepromptInput {
	/** The conversation's stored system prompt. */
	conversationPreprompt?: string;
	/** Whether this conversation runs the ML Assistant preset. */
	mlAssistant: boolean;
	/** Per-model user override for artifacts, from the model settings page. */
	artifactsOverride?: boolean;
	/** Whether the model advertises artifact support (supportsArtifacts). */
	supportsArtifacts?: boolean;
	/** Signed-in user's Hub username. The preset's namespace rule reads it back. */
	username?: string;
	/** IANA zone from the request, so the stamped time is the user's. */
	timezone?: string;
	/** Injectable clock, for tests. */
	now?: Date;
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
	username,
	timezone,
	now,
}: PrepromptInput): string | undefined {
	const base = mlAssistant ? ML_ASSISTANT_PREPROMPT : conversationPreprompt;
	const artifacts = mlAssistant || (artifactsOverride ?? supportsArtifacts);
	const resolved = artifacts ? injectArtifactsPrompt(base) : base;
	if (!mlAssistant) return resolved;
	// Stamped last, after the artifacts prompt, because the preset reads the User
	// value back out of it — and stamped here rather than onto the tool preprompt
	// so it still reaches the model on the plain generation path, which has none.
	return `${resolved}\n\n${mlAssistantSessionContext({ username, timezone, now })}`;
}
