import { error, json, type RequestHandler } from "@sveltejs/kit";
import { z } from "zod";
import { requireAuth } from "$lib/server/api/utils/requireAuth";
import { resolveConversation } from "$lib/server/api/utils/resolveConversation";
import { getUserHubWriteToken } from "$lib/server/apiToken";
import { buildConversationTrace } from "$lib/server/conversationTrace";
import { isMlAssistantConversation } from "$lib/server/mlAssistant";
import { pushTraceToDataset, traceRepoSchema, tracePath } from "$lib/server/traceToHub";

const bodySchema = z.object({
	repo: traceRepoSchema,
	allowPublic: z.boolean().default(false),
});

export const POST: RequestHandler = async ({ locals, params, request }) => {
	requireAuth(locals);

	const id = params.id ?? "";
	const conversation = await resolveConversation(id, locals);
	if (conversation.kind === "share" || !isMlAssistantConversation(conversation)) {
		error(404, "Conversation not found");
	}
	const accessToken = getUserHubWriteToken(locals);
	if (!accessToken) error(403, "This sign-in cannot write to the Hugging Face Hub.");

	const body = bodySchema.safeParse(await request.json().catch(() => null));
	if (!body.success) error(400, body.error.issues[0]?.message ?? "Invalid dataset");
	const { repo, allowPublic } = body.data;

	const trace = await buildConversationTrace(conversation.objectId, conversation);
	const path = tracePath(trace.conversation.id);
	const result = await pushTraceToDataset({
		repo,
		accessToken,
		path,
		content: JSON.stringify(trace, null, 2),
		title: conversation.title,
		allowPublic,
	});
	if (!result.ok) {
		return json({ message: result.message, code: result.code }, { status: result.status });
	}
	return json({ repo, path, url: result.url, created: result.created, private: result.private });
};
