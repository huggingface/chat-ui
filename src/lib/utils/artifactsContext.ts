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

const KEY = Symbol("artifacts");

export function setArtifactsContext(ctx: ArtifactsContext) {
	setContext(KEY, ctx);
}

export function getArtifactsContext(): ArtifactsContext | undefined {
	return getContext<ArtifactsContext | undefined>(KEY);
}
