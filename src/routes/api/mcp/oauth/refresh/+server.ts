import { z } from "zod";
import { error, json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { logger } from "$lib/server/logger";
import { getOAuthConnection, resolveOAuthAccessToken } from "$lib/server/mcp/oauth/connections";

const Body = z.object({
	connectionId: z.string().min(1),
});

export const POST: RequestHandler = async ({ request, locals }) => {
	let parsed: z.infer<typeof Body>;
	try {
		parsed = Body.parse(await request.json());
	} catch (e) {
		return error(400, e instanceof Error ? e.message : "Invalid request body");
	}

	try {
		const connection = await getOAuthConnection(locals, parsed.connectionId);
		const result = await resolveOAuthAccessToken(locals, parsed.connectionId, connection.serverUrl);
		return json({ connection: result.state });
	} catch (e) {
		const msg = e instanceof Error ? e.message : "Refresh failed";
		logger.warn({ err: msg }, "[mcp-oauth] refresh failed");
		return error(401, msg);
	}
};
