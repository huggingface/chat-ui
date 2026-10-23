import { error, type RequestHandler } from "@sveltejs/kit";
import { requireAuth } from "$lib/server/api/utils/requireAuth";
import { resolveConversation } from "$lib/server/api/utils/resolveConversation";
import { buildConversationTrace, traceFilename } from "$lib/server/conversationTrace";

export const GET: RequestHandler = async ({ locals, params }) => {
	requireAuth(locals);

	const id = params.id ?? "";
	const conversation = await resolveConversation(id, locals);
	// a share snapshot has no registry of its own, and its reader is not the owner
	if (conversation.kind === "share") error(404, "Conversation not found");
	const trace = await buildConversationTrace(conversation.objectId, conversation);
	const filename = traceFilename(trace.conversation.id, conversation.title);

	return new Response(JSON.stringify(trace, null, 2), {
		headers: {
			"Content-Type": "application/json; charset=utf-8",
			"Content-Disposition": `attachment; filename="${filename}"`,
			"Cache-Control": "no-store",
		},
	});
};
