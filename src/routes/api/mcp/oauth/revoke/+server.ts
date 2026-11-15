import { z } from "zod";
import { error, json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { deleteOAuthConnection } from "$lib/server/mcp/oauth/connections";

const Body = z.object({
	connectionId: z.string().min(1),
	force: z.boolean().optional(),
});

export const POST: RequestHandler = async ({ request, locals }) => {
	let parsed: z.infer<typeof Body>;
	try {
		parsed = Body.parse(await request.json());
	} catch (e) {
		return error(400, e instanceof Error ? e.message : "Invalid request body");
	}

	try {
		const result = await deleteOAuthConnection(locals, parsed.connectionId, {
			force: parsed.force,
		});
		if (!result.deleted) {
			// Revocation may have failed and the record was kept so the user can retry; signal a
			// non-2xx so the client keeps its local connection instead of assuming it's gone.
			return json({ disconnected: false, revoked: false }, { status: 502 });
		}
		return json({ disconnected: true, revoked: result.revoked });
	} catch (e) {
		return error(404, e instanceof Error ? e.message : "OAuth connection was not found");
	}
};
