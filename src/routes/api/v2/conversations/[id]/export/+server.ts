import { error, type RequestHandler } from "@sveltejs/kit";
import { ObjectId } from "mongodb";
import { requireAuth } from "$lib/server/api/utils/requireAuth";
import { resolveConversation } from "$lib/server/api/utils/resolveConversation";
import { buildConversationTrace, traceFilename } from "$lib/server/conversationTrace";

export const GET: RequestHandler = async ({ locals, params }) => {
	requireAuth(locals);

	const id = params.id ?? "";
	// a share snapshot has no registry of its own, and its reader is not the owner
	if (id.length === 7) error(404, "Conversation not found");

	const conversation = await resolveConversation(id, locals);
	const trace = await buildConversationTrace(new ObjectId(conversation._id), conversation);
	const filename = traceFilename(trace.conversation.id, conversation.title);

	return new Response(JSON.stringify(trace, null, 2), {
		headers: {
			"Content-Type": "application/json; charset=utf-8",
			"Content-Disposition": `attachment; filename="${filename}"`,
			"Cache-Control": "no-store",
		},
	});
};
