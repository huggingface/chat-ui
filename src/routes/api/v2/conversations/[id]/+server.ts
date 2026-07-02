import { error, type RequestHandler } from "@sveltejs/kit";
import { superjsonResponse } from "$lib/server/api/utils/superjsonResponse";
import { requireAuth } from "$lib/server/api/utils/requireAuth";
import { resolveConversation } from "$lib/server/api/utils/resolveConversation";
import { collections } from "$lib/server/database";
import { authCondition } from "$lib/server/auth";
import { ObjectId } from "mongodb";
import { validModelIdSchema } from "$lib/server/models";
import type { Message } from "$lib/types/Message";
import { MessageUpdateType, MessageReasoningUpdateType } from "$lib/types/MessageUpdate";

/**
 * Drop persisted message data the client never reads before sending it over
 * the wire: the server-side `reasoning` accumulator, raw reasoning stream
 * tokens, and — for tool-less messages — the per-token stream markers and the
 * FinalAnswer text (a duplicate of `message.content`). ChatMessage rebuilds
 * tool-less messages from `message.content` alone, while messages with tool
 * calls need the stream markers and FinalAnswer text to interleave text
 * between tool blocks, so their updates are kept.
 *
 * Read-path only: MongoDB keeps the full document (the legacy
 * /api/conversation/[id] endpoint still exposes complete updates).
 */
function trimMessageForResponse(message: Message): Message {
	const trimmed = { ...message };
	delete trimmed.reasoning;
	const updates = trimmed.updates;
	if (!updates?.length) return trimmed;
	const hasTool = updates.some((u) => u.type === MessageUpdateType.Tool);
	trimmed.updates = updates
		.filter(
			(u) =>
				!(u.type === MessageUpdateType.Reasoning && u.subtype === MessageReasoningUpdateType.Stream)
		)
		.filter((u) => hasTool || u.type !== MessageUpdateType.Stream)
		.map((u) => (!hasTool && u.type === MessageUpdateType.FinalAnswer ? { ...u, text: "" } : u));
	return trimmed;
}

export const GET: RequestHandler = async ({ locals, params, url }) => {
	requireAuth(locals);

	const conversation = await resolveConversation(
		params.id ?? "",
		locals,
		url.searchParams.get("fromShare")
	);

	return superjsonResponse({
		messages: conversation.messages.map(trimMessageForResponse),
		title: conversation.title,
		model: conversation.model,
		preprompt: conversation.preprompt,
		rootMessageId: conversation.rootMessageId,
		id: conversation._id.toString(),
		updatedAt: conversation.updatedAt,
		modelId: conversation.model,
		shared: conversation.shared,
		deployedSpaces: "deployedSpaces" in conversation ? conversation.deployedSpaces : undefined,
	});
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
	requireAuth(locals);

	const id = params.id ?? "";
	if (!ObjectId.isValid(id)) {
		error(400, "Invalid conversation ID");
	}
	const res = await collections.conversations.deleteOne({
		_id: new ObjectId(id),
		...authCondition(locals),
	});

	if (res.deletedCount === 0) {
		error(404, "Conversation not found");
	}

	return superjsonResponse({ success: true });
};

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
	requireAuth(locals);

	const body = await request.json();
	const title = body?.title as string | undefined;
	const model = body?.model as string | undefined;

	if (title !== undefined) {
		if (typeof title !== "string" || title.length === 0 || title.length > 100) {
			error(400, "Title must be a string between 1 and 100 characters");
		}
	}

	if (model !== undefined) {
		if (!validModelIdSchema.safeParse(model).success) {
			error(400, "Invalid model ID");
		}
	}

	const updateValues = {
		...(title !== undefined && {
			title: title.replace(/<\/?think>/gi, "").trim(),
		}),
		...(model !== undefined && { model }),
	};

	const id = params.id ?? "";
	if (!ObjectId.isValid(id)) {
		error(400, "Invalid conversation ID");
	}
	const res = await collections.conversations.updateOne(
		{
			_id: new ObjectId(id),
			...authCondition(locals),
		},
		{ $set: updateValues }
	);

	if (typeof res.matchedCount === "number" ? res.matchedCount === 0 : res.modifiedCount === 0) {
		error(404, "Conversation not found");
	}

	return superjsonResponse({ success: true });
};
