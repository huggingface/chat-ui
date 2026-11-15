import { z } from "zod";
import { error, json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import {
	getOAuthConnection,
	OAuthConnectionAccessError,
	publicOAuthState,
} from "$lib/server/mcp/oauth/connections";

const Body = z.object({
	connectionIds: z.array(z.string().min(1)).max(50),
});

// Owner-checked current state for the given connections, so the client can reconcile local OAuth
// state after a background change (e.g. a scope challenge recorded mid-chat) instead of showing stale
// "authorized" indefinitely. Missing/unowned ids are reported so the client can drop stale state.
export const POST: RequestHandler = async ({ request, locals }) => {
	let parsed: z.infer<typeof Body>;
	try {
		parsed = Body.parse(await request.json());
	} catch (e) {
		return error(400, e instanceof Error ? e.message : "Invalid request body");
	}

	const states = await Promise.all(
		parsed.connectionIds.map(async (connectionId) => {
			try {
				const connection = await getOAuthConnection(locals, connectionId);
				return { connectionId, state: publicOAuthState(connection) };
			} catch (e) {
				// Only a definite not-found may clear client state; a transient failure is left out so
				// the client keeps what it has instead of orphaning a live grant.
				if (e instanceof OAuthConnectionAccessError) {
					return { connectionId, missing: true as const };
				}
				return undefined;
			}
		})
	);

	return json({ states: states.filter((s) => s !== undefined) });
};
