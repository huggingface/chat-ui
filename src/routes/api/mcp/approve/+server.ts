import type { RequestHandler } from "@sveltejs/kit";
import { error, json } from "@sveltejs/kit";
import { z } from "zod";
import { requireAuth } from "$lib/server/api/utils/requireAuth";
import { resolveApproval } from "$lib/server/mcp/approvalRegistry";

const approveBodySchema = z.object({
	approvalId: z.string().uuid(),
	decision: z.enum(["allow", "deny", "always"]),
});

export const POST: RequestHandler = async ({ locals, request }) => {
	requireAuth(locals);

	const userKey =
		locals.user?._id?.toString() ?? (locals as unknown as { sessionId?: string }).sessionId;
	if (!userKey) {
		error(401, "Must have a valid session or user");
	}

	let parsed: z.infer<typeof approveBodySchema>;
	try {
		parsed = approveBodySchema.parse(await request.json());
	} catch {
		error(400, "Invalid approval payload");
	}

	const outcome = resolveApproval(parsed.approvalId, parsed.decision, userKey);
	if (outcome === "not_found") {
		error(404, "Approval not found or already resolved");
	}
	if (outcome === "forbidden") {
		error(403, "Approval belongs to a different session");
	}

	return json({ ok: true });
};
