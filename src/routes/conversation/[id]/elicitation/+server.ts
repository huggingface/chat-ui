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
	/**
	 * Shape-checked here only far enough to be JSON of the right primitive kinds; the
	 * real check is against the schema the server actually asked for, which lives on the
	 * stored request rather than in anything the browser sends.
	 */
	content: z
		.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]))
		.optional(),
});

/**
 * Deliver a user's answer to an MCP server waiting mid tool call.
 *
 * Deliberately not part of the generation stream: the run holding the tool call may be on
 * another pod, so the answer is written to the conversation's pending elicitation and the
 * waiting pod picks it up from there.
 */
export const POST: RequestHandler = async ({ params, locals, request }) => {
	if (!locals.user && !locals.sessionId) error(401, "Unauthorized");

	const conversationId = new ObjectId(z.string().parse(params.id));

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

	return json({ ok: true });
};
