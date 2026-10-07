import type { TrackioDashboardView } from "$lib/utils/trackioView";

export interface ComposerDraft {
	draft: string;
	files: File[];
	dashboardViews: TrackioDashboardView[];
}

/**
 * The conversation page is reused across conversations, so without this a
 * draft would follow the user into the next chat. In memory only: attachments
 * are File objects.
 */
const drafts = new Map<string, ComposerDraft>();
const MAX_DRAFTS = 20;

export function saveComposerDraft(conversationId: string, draft: ComposerDraft): void {
	if (!conversationId) return;
	if (!draft.draft.trim() && !draft.files.length && !draft.dashboardViews.length) {
		drafts.delete(conversationId);
		return;
	}
	drafts.delete(conversationId);
	drafts.set(conversationId, draft);
	// Maps iterate oldest first.
	for (const id of drafts.keys()) {
		if (drafts.size <= MAX_DRAFTS) break;
		drafts.delete(id);
	}
}

export function takeComposerDraft(conversationId: string): ComposerDraft {
	const draft = drafts.get(conversationId);
	drafts.delete(conversationId);
	return draft ?? { draft: "", files: [], dashboardViews: [] };
}
