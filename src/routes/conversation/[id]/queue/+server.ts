import type { RequestHandler } from "./$types";
import { authCondition } from "$lib/server/auth";
import { collections } from "$lib/server/database";
import { isMlAssistantConversation } from "$lib/server/mlAssistant";
import { wakeParkForQueuedInput } from "$lib/server/queuedInputs/deliver";
import { kickQueuedTurn } from "$lib/server/queuedInputs/drain";
import {
	MAX_QUEUED_INPUT_CHARS,
	QueueFullError,
	cancelQueuedInput,
	enqueueInput,
	listQueuedInputs,
	queuedInputView,
} from "$lib/server/queuedInputs/store";
import { error, json } from "@sveltejs/kit";
import { ObjectId } from "mongodb";
import { z } from "zod";

async function ownedMlConversation(params: { id: string }, locals: App.Locals) {
	if (!locals.user && !locals.sessionId) error(401, "Unauthorized");
	if (!ObjectId.isValid(params.id)) error(404, "Conversation not found");
	const conversation = await collections.conversations.findOne(
		{ _id: new ObjectId(params.id), ...authCondition(locals) },
		{ projection: { _id: 1, mlAssistant: 1 } }
	);
	if (!conversation) error(404, "Conversation not found");
	if (!isMlAssistantConversation(conversation)) error(400, "Only ML Intern conversations queue");
	return conversation._id;
}

export const GET: RequestHandler = async ({ params, locals }) => {
	const conversationId = await ownedMlConversation(params, locals);
	return json({ inputs: await listQueuedInputs(conversationId) });
};

const postSchema = z.object({ text: z.string().trim().min(1).max(MAX_QUEUED_INPUT_CHARS) });

export const POST: RequestHandler = async ({ params, locals, request }) => {
	const conversationId = await ownedMlConversation(params, locals);
	const parsed = postSchema.safeParse(await request.json().catch(() => null));
	if (!parsed.success) error(400, "Invalid message");

	let row;
	try {
		row = await enqueueInput({
			conversationId,
			text: parsed.data.text,
			source: "web",
			...(locals.user?._id ? { userId: locals.user._id } : {}),
			...(locals.sessionId ? { sessionId: locals.sessionId } : {}),
		});
	} catch (err) {
		if (err instanceof QueueFullError) error(429, err.message);
		throw err;
	}
	await wakeParkForQueuedInput(conversationId);
	// a turn that ended between the browser check and this insert has nothing left to read it
	kickQueuedTurn(conversationId);
	return json({ input: queuedInputView(row) });
};

const deleteSchema = z.object({ id: z.string().refine((id) => ObjectId.isValid(id)) });

export const DELETE: RequestHandler = async ({ params, locals, request }) => {
	const conversationId = await ownedMlConversation(params, locals);
	const parsed = deleteSchema.safeParse(await request.json().catch(() => null));
	if (!parsed.success) error(400, "Invalid request");
	const cancelled = await cancelQueuedInput(conversationId, new ObjectId(parsed.data.id));
	// the turn already read it, the browser keeps it as sent
	if (!cancelled) return json({ cancelled: false }, { status: 409 });
	return json({ cancelled: true });
};
