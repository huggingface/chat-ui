import type { RequestHandler } from "./$types";
import { authCondition } from "$lib/server/auth";
import { collections } from "$lib/server/database";
import { sweepParkedCalls, wakeParkedCallEarly } from "$lib/server/generation/parkedSweeper";
import { logger } from "$lib/server/logger";
import { error, json } from "@sveltejs/kit";
import { ObjectId } from "mongodb";
import { z } from "zod";

const bodySchema = z.object({ messageId: z.string().min(1) });

/**
 * "Check now": the user would rather not sit out the rest of a parked turn's
 * timer. Separate from the generation stream for the same reason answering an
 * elicitation is — by now no run is holding the turn at all, and the pod that
 * parked it need not be this one.
 */
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
	if (!parsed.success) error(400, "Invalid wake request");

	const woken = await wakeParkedCallEarly(conversationId, parsed.data.messageId);
	if (!woken) error(409, "That turn is not waiting on a timer");

	// Not awaited: the sweep runs the resumed turn to completion — minutes of
	// work, not a request's worth. The deadline move above is what makes the
	// wake durable; this only spares the user the sweep interval.
	void sweepParkedCalls().catch((err) =>
		logger.error({ err }, "[parked] the sweep kicked by an early wake failed")
	);

	return json({ ok: true });
};
