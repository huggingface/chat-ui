import { error, type RequestHandler } from "@sveltejs/kit";
import { ObjectId } from "mongodb";
import { requireAuth } from "$lib/server/api/utils/requireAuth";
import { resolveConversation } from "$lib/server/api/utils/resolveConversation";
import { stopSandbox } from "$lib/server/mlRegistry/stop";

export const POST: RequestHandler = async ({ locals, params }) => {
	requireAuth(locals);

	const id = params.id ?? "";
	// a share snapshot has no registry of its own, and its reader is not the owner
	if (id.length === 7) error(404, "Conversation not found");

	const conversation = await resolveConversation(id, locals);
	const serviceId = params.serviceId ?? "";
	if (!ObjectId.isValid(serviceId)) error(404, "No such sandbox in this conversation.");

	const outcome = await stopSandbox({
		conversationId: new ObjectId(conversation._id),
		serviceId: new ObjectId(serviceId),
		requestToken: locals.token,
	});
	if (!outcome.ok) error(outcome.status, outcome.message);
	return new Response();
};
