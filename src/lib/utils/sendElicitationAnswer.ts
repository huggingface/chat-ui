import { base } from "$app/paths";
import { elicitationToResume } from "$lib/stores/elicitationResume";
import type { ElicitationAction, ElicitationValue } from "$lib/types/McpElicitation";

/** Shared, so neither answer path can forget to ask for the parked run to be continued. */
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
}): Promise<{ ok: true } | { ok: false; error: string }> {
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
	if (!res.ok) {
		const message = (body as { message?: unknown } | null)?.message;
		return {
			ok: false,
			error: typeof message === "string" ? message : "Could not send your answer.",
		};
	}

	// A parked call has nothing waiting on it, so answering only records the answer — the
	// run that continues it has to be started.
	const parsed = body as { resume?: boolean; messageId?: string } | null;
	if (parsed?.resume) {
		elicitationToResume.set({
			conversationId,
			elicitationId,
			...(parsed.messageId ? { messageId: parsed.messageId } : {}),
		});
	}
	return { ok: true };
}
