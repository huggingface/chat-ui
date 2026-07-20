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
}

/**
 * Exported so tests can seed this context without mounting the whole ChatWindow.
 * `setArtifactsContext` is init-only like every `setContext`, so a test harness that
 * wants to render an ArtifactCard in isolation needs the key itself. Not intended for
 * application code — use the accessors below.
 */
export const ARTIFACTS_CONTEXT_KEY = Symbol("artifacts");

const KEY = ARTIFACTS_CONTEXT_KEY;

export function setArtifactsContext(ctx: ArtifactsContext): void {
	setContext(KEY, ctx);
}

export function getArtifactsContext(): ArtifactsContext | undefined {
	return getContext<ArtifactsContext | undefined>(KEY);
}
