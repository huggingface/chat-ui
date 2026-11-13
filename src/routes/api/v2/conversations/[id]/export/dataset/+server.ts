import { error, json, type RequestHandler } from "@sveltejs/kit";
import { z } from "zod";
import { requireAuth } from "$lib/server/api/utils/requireAuth";
import { resolveConversation } from "$lib/server/api/utils/resolveConversation";
import { buildConversationTrace, traceFilename } from "$lib/server/conversationTrace";
import { isMlAssistantConversation } from "$lib/server/mlAssistant";
import { logger } from "$lib/server/logger";
import {
	pushTraceToDataset,
	TracePushError,
	traceRepoSchema,
	tracePath,
} from "$lib/server/traceToHub";

const bodySchema = z.object({ repo: traceRepoSchema });

export const POST: RequestHandler = async ({ locals, params, request }) => {
	requireAuth(locals);

	const id = params.id ?? "";
	const conversation = await resolveConversation(id, locals);
	if (conversation.kind === "share" || !isMlAssistantConversation(conversation)) {
		error(404, "Conversation not found");
	}
	if (!locals.token) error(403, "Sign in with Hugging Face to push to the Hub.");

	const body = bodySchema.safeParse(await request.json().catch(() => null));
	if (!body.success) error(400, body.error.issues[0]?.message ?? "Invalid dataset");
	const { repo } = body.data;

	const trace = await buildConversationTrace(conversation.objectId, conversation);
	const path = tracePath(traceFilename(trace.conversation.id, conversation.title));
	try {
		const pushed = await pushTraceToDataset({
			repo,
			accessToken: locals.token,
			path,
			content: JSON.stringify(trace, null, 2),
			title: conversation.title,
		});
		return json({ repo, path, ...pushed });
	} catch (err) {
		if (!(err instanceof TracePushError)) throw err;
		logger.warn({ err, conversationId: conversation.id, repo }, "[trace] push to dataset failed");
		error(err.status, err.message);
	}
};
