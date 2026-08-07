import { z } from "zod";
import { error, json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { deleteOAuthConnection } from "$lib/server/mcp/oauth/connections";

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
		const result = await deleteOAuthConnection(locals, parsed.connectionId);
		return json({ disconnected: true, revoked: result.revoked });
	} catch (e) {
		return error(404, e instanceof Error ? e.message : "OAuth connection was not found");
	}
};
