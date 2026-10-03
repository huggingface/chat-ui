import type { TrackioDashboardView } from "$lib/utils/trackioView";

export interface ComposerDraft {
	draft: string;
	files: File[];
	dashboardViews: TrackioDashboardView[];
}

/**
 * Unsent composer content per conversation, for this tab's lifetime. The
 * conversation page is reused across conversations, so without this whatever
 * was typed (or attached) in one chat would follow the user into the next.
 * In memory only: attachments are File objects, and a reload starting clean is
 * the existing behavior.
 */
const drafts = new Map<string, ComposerDraft>();

export function saveComposerDraft(conversationId: string, draft: ComposerDraft): void {
	if (!conversationId) return;
	if (!draft.draft.trim() && !draft.files.length && !draft.dashboardViews.length) {
		drafts.delete(conversationId);
		return;
	}
	drafts.set(conversationId, draft);
}

/** The conversation's saved draft, removed from the store, or an empty one. */
export function takeComposerDraft(conversationId: string): ComposerDraft {
	const draft = drafts.get(conversationId);
	drafts.delete(conversationId);
	return draft ?? { draft: "", files: [], dashboardViews: [] };
}
