import { getContext, setContext } from "svelte";
import type { ArtifactRegistry } from "./artifacts";
import type { artifactPanel } from "$lib/stores/artifactPanel.svelte";

/**
 * Context bridging ChatWindow (which derives the artifact registry from the
 * visible message path) and the inline ArtifactCard components rendered deep
 * inside ChatMessage.
 */
export interface ArtifactsContext {
	readonly registry: ArtifactRegistry;
	panel: typeof artifactPanel;
	/**
	 * Sends a preview-error fix request straight to the chat as a user message,
	 * returning whether it was dispatched. Undefined while the conversation
	 * can't accept a message (read-only, errored generation, streaming), so
	 * consumers hide their ask-to-fix control instead of rendering a dead one.
	 */
	readonly requestFix?: (text: string) => boolean;
}

/** Exported for test harnesses that seed this context without mounting ChatWindow. */
export const ARTIFACTS_CONTEXT_KEY = Symbol("artifacts");

export function setArtifactsContext(ctx: ArtifactsContext): void {
	setContext(ARTIFACTS_CONTEXT_KEY, ctx);
}

export function getArtifactsContext(): ArtifactsContext | undefined {
	return getContext<ArtifactsContext | undefined>(ARTIFACTS_CONTEXT_KEY);
}
