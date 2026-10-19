import type { RequestHandler } from "./$types";
import { ownedMlConversation } from "$lib/server/queuedInputs/access";
import { wakeParkForQueuedInput } from "$lib/server/queuedInputs/deliver";
import { kickQueuedTurn } from "$lib/server/queuedInputs/drain";
import {
	QueueFullError,
	QueuedInputTooLongError,
	cancelQueuedInput,
	enqueueInput,
	listQueuedInputs,
	queuedInputView,
} from "$lib/server/queuedInputs/store";
import { error, json } from "@sveltejs/kit";
import { ObjectId } from "mongodb";
import { z } from "zod";

export const GET: RequestHandler = async ({ params, locals }) => {
	const conversationId = await ownedMlConversation(params, locals);
	return json({ inputs: await listQueuedInputs(conversationId) });
};

const postSchema = z.object({ text: z.string().trim().min(1) });

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
		if (err instanceof QueuedInputTooLongError) error(413, err.message);
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
