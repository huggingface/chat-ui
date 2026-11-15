import { error, type RequestHandler } from "@sveltejs/kit";
import { ObjectId } from "mongodb";
import { requireAuth } from "$lib/server/api/utils/requireAuth";
import { resolveConversation } from "$lib/server/api/utils/resolveConversation";
import { stopSandbox } from "$lib/server/mlRegistry/stop";

export const POST: RequestHandler = async ({ locals, params }) => {
	requireAuth(locals);

	const id = params.id ?? "";
	const conversation = await resolveConversation(id, locals);
	// a share snapshot has no registry of its own, and its reader is not the owner
	if (conversation.kind === "share") error(404, "Conversation not found");
	const serviceId = params.serviceId ?? "";
	if (!ObjectId.isValid(serviceId)) error(404, "No such sandbox in this conversation.");

	const outcome = await stopSandbox({
		conversationId: conversation.objectId,
		serviceId: new ObjectId(serviceId),
		requestToken: locals.token,
	});
	if (!outcome.ok) error(outcome.status, outcome.message);
	return new Response();
};
