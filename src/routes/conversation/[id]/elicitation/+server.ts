import type { RequestHandler } from "./$types";
import { authCondition } from "$lib/server/auth";
import { collections } from "$lib/server/database";
import { submitElicitationAnswer } from "$lib/server/mcp/elicitation";
import { error, json } from "@sveltejs/kit";
import { ObjectId } from "mongodb";
import { z } from "zod";

const bodySchema = z.object({
	elicitationId: z.string().uuid(),
	action: z.enum(["accept", "decline", "cancel"]),
	/** Only shape-checked here; the real check is against the stored requested schema. */
	content: z
		.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]))
		.optional(),
});

/** Separate from the generation stream: the run holding the tool call may be on another pod. */
export const POST: RequestHandler = async ({ params, locals, request }) => {
	if (!locals.user && !locals.sessionId) error(401, "Unauthorized");

	if (!ObjectId.isValid(params.id)) error(404, "Conversation not found");
	const conversationId = new ObjectId(params.id);

	const conversation = await collections.conversations.findOne(
		{ _id: conversationId, ...authCondition(locals) },
		{ projection: { _id: 1 } }
	);
	if (!conversation) error(404, "Conversation not found");

	const parsed = bodySchema.safeParse(await request.json().catch(() => null));
	if (!parsed.success) error(400, "Invalid elicitation response");

	const result = await submitElicitationAnswer({
		elicitationId: parsed.data.elicitationId,
		conversationId,
		action: parsed.data.action,
		content: parsed.data.content,
	});

	if (!result.ok) error(result.status, result.error);

	// A parked 2026-era call resumes on a fresh run; a blocking one is already unblocked.
	return json({ ok: true, resume: result.resume });
};
