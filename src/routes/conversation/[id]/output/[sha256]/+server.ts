import { authCondition } from "$lib/server/auth";
import { collections } from "$lib/server/database";
import { error } from "@sveltejs/kit";
import { ObjectId } from "mongodb";
import { z } from "zod";
import type { RequestHandler } from "./$types";
import { downloadFile } from "$lib/server/files/downloadFile";

export const GET: RequestHandler = async ({ locals, params }) => {
	const convId = new ObjectId(z.string().parse(params.id));
	const sha256 = z.string().parse(params.sha256);

	const userId = locals.user?._id ?? locals.sessionId;

	// check user
	if (!userId) {
		throw error(401, "Unauthorized");
	}

	// check if the user has access to the conversation
	const conv = await collections.conversations.findOne({
		_id: convId,
		...authCondition(locals),
	});

	if (!conv) {
		throw error(404, "Conversation not found");
	}

	const { content, mime } = await downloadFile(sha256, convId);

	return new Response(content, {
		headers: {
			"Content-Type": mime ?? "application/octet-stream",
		},
	});
};
