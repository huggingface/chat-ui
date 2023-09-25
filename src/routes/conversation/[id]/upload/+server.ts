import { authCondition } from "$lib/server/auth";
import { collections } from "$lib/server/database";
import { uploadFile } from "$lib/server/tools/uploadFile";
import { error } from "@sveltejs/kit";
import { ObjectId } from "mongodb";
import { z } from "zod";
import type { RequestHandler } from "../$types";

export const POST: RequestHandler = async ({ locals, params, request }) => {
	const convId = new ObjectId(z.string().parse(params.id));
	const data = await request.formData();

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

	const file = data.get("file") as File;

	if (!file) {
		throw error(400, "No file provided");
	}

	const filename = await uploadFile(file, conv);

	return new Response(filename);
};
