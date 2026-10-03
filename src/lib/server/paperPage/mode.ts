import type { Conversation } from "$lib/types/Conversation";
import { config } from "$lib/server/config";

/**
 * PaperPage Intern: an agent mode that builds a research project page with the user. The page
 * lives in a Docker "workshop" Space created from PAPERPAGE_TEMPLATE_SPACE, runs a live Vite
 * dev server shown in the side pane, and is published to a static Space. See
 * docs/source/configuration/paperpage.md.
 *
 * On while PAPERPAGE_TEMPLATE_SPACE is set, a runtime switch rather than a build flag: the mode
 * needs nothing compiled in beyond its deep link.
 */
export function paperPageEnabled(): boolean {
	return !!config.PAPERPAGE_TEMPLATE_SPACE?.trim();
}

/** Whether this conversation runs the PaperPage preset. */
export function isPaperPageConversation(conv: Pick<Conversation, "agentMode">): boolean {
	return conv.agentMode === "paperpage" && paperPageEnabled();
}
