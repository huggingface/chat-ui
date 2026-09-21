import { base } from "$app/paths";
import { elicitationToResume } from "$lib/stores/elicitationResume";
import type {
	AnsweredElicitation,
	ElicitationAction,
	ElicitationValue,
} from "$lib/types/McpElicitation";

/** Shared, so neither answer path can forget a continuation the server leaves to the client. */
export async function sendElicitationAnswer({
	conversationId,
	elicitationId,
	action,
	content,
}: {
	conversationId: string;
	elicitationId: string;
	action: ElicitationAction;
	content?: Record<string, ElicitationValue>;
}): Promise<{ ok: true } | { ok: false; error: string; answered?: true }> {
	let res: Response;
	try {
		res = await fetch(`${base}/conversation/${conversationId}/elicitation`, {
			method: "POST",
			// Without Accept, SvelteKit answers `error()` with an HTML page.
			headers: { "Content-Type": "application/json", Accept: "application/json" },
			body: JSON.stringify({ elicitationId, action, ...(content ? { content } : {}) }),
		});
	} catch {
		return { ok: false, error: "Could not send your answer." };
	}

	const body = await res.json().catch(() => null);

	// Only when the server says so (`resume`). It continues the model's own questions itself
	// and answers false, and the page just follows the turn; a parked MCP call is still
	// started from here, because the server it re-issues against may exist only in this
	// browser's configuration.
	const queueResume = (messageId?: string) =>
		elicitationToResume.set({
			conversationId,
			elicitationId,
			...(messageId ? { messageId } : {}),
		});

	if (!res.ok) {
		const parsed = body as { message?: unknown; answered?: AnsweredElicitation } | null;
		// An earlier answer to a parked MCP call stands but never continued it: the page that
		// sent it lost its cue, so this attempt is what starts the continuation instead.
		if (parsed?.answered?.resume) queueResume(parsed.answered.messageId);
		return {
			ok: false,
			error: typeof parsed?.message === "string" ? parsed.message : "Could not send your answer.",
			...(parsed?.answered ? { answered: true } : {}),
		};
	}

	const parsed = body as { resume?: boolean; messageId?: string } | null;
	if (parsed?.resume) queueResume(parsed.messageId);
	return { ok: true };
}
