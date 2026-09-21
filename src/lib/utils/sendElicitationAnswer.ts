import { base } from "$app/paths";
import { get } from "svelte/store";
import { elicitationToResume } from "$lib/stores/elicitationResume";
import type {
	AnsweredElicitation,
	ElicitationAction,
	ElicitationValue,
} from "$lib/types/McpElicitation";

/**
 * The tool selection the message route is sent, for the turn the server continues from the
 * answer. Omitted until the store has hydrated: an empty list filters the configured servers
 * to nothing, where no list at all falls back to them — which is also what any failure to
 * read it does, because the answer matters more than the selection. Imported on use: the
 * store reads public env at load, and this module is reached from components that render
 * without one.
 */
async function mcpSelection() {
	try {
		const { enabledServers, mcpServersLoaded } = await import("$lib/stores/mcpServers");
		if (!get(mcpServersLoaded)) return {};
		const servers = get(enabledServers);
		return {
			selectedMcpServerNames: servers.map((s) => s.name),
			selectedMcpServers: servers.map((s) => ({ name: s.name, url: s.url, headers: s.headers })),
			timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
		};
	} catch {
		return {};
	}
}

/** Shared, so neither answer path can forget a continuation the server leaves to the client. */
export async function sendElicitationAnswer({
	conversationId,
	elicitationId,
	action,
	content,
	withToolSelection = false,
}: {
	conversationId: string;
	elicitationId: string;
	action: ElicitationAction;
	content?: Record<string, ElicitationValue>;
	/**
	 * For the model's own questions, which the server continues from this request. Not sent
	 * otherwise: a custom server's headers can hold credentials, and nothing would read them.
	 */
	withToolSelection?: boolean;
}): Promise<{ ok: true } | { ok: false; error: string; answered?: true }> {
	const selection = withToolSelection ? await mcpSelection() : {};
	let res: Response;
	try {
		res = await fetch(`${base}/conversation/${conversationId}/elicitation`, {
			method: "POST",
			// Without Accept, SvelteKit answers `error()` with an HTML page.
			headers: { "Content-Type": "application/json", Accept: "application/json" },
			body: JSON.stringify({
				elicitationId,
				action,
				...(content ? { content } : {}),
				...selection,
			}),
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
