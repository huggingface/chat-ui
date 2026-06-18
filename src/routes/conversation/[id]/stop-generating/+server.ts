import { authCondition } from "$lib/server/auth";
import { collections } from "$lib/server/database";
import { AbortRegistry } from "$lib/server/abortRegistry";
import { error } from "@sveltejs/kit";
import { ObjectId } from "mongodb";
import { z } from "zod";

const stopPointSchema = z.object({
	generationId: z.string().uuid(),
	seenContentLength: z.number().int().nonnegative(),
});

/**
 * Ideally, we'd be able to detect the client-side abort, see https://github.com/huggingface/chat-ui/pull/88#issuecomment-1523173850
 */
export async function POST({ params, locals, request }) {
	if (!locals.user && !locals.sessionId) {
		error(401, "Unauthorized");
	}

	const conversationId = new ObjectId(params.id);

	const conversation = await collections.conversations.findOne({
		_id: conversationId,
		...authCondition(locals),
	});

	if (!conversation) {
		error(404, "Conversation not found");
	}

	// Optional stop point from the stopping client (see AbortedGeneration).
	// Parsed leniently: a stop must succeed even with a missing or malformed
	// body (legacy clients send none).
	let stopPoint: z.infer<typeof stopPointSchema> | undefined;
	try {
		stopPoint = stopPointSchema.parse(await request.json());
	} catch {
		stopPoint = undefined;
	}

	// Write the marker before aborting the in-process registry so a finalize
	// triggered by a same-pod abort always finds the stop point on it.
	await collections.abortedGenerations.updateOne(
		{ conversationId },
		{
			$set: { updatedAt: new Date(), ...stopPoint },
			$setOnInsert: { createdAt: new Date() },
		},
		{ upsert: true }
	);

	AbortRegistry.getInstance().abort(conversationId.toString());

	return new Response();
}
