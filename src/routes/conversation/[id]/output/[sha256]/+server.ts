import { authCondition } from "$lib/server/auth";
import { collections } from "$lib/server/database";
import { error } from "@sveltejs/kit";
import { ObjectId } from "mongodb";
import { z } from "zod";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async ({ locals, params }) => {
	const convId = new ObjectId(z.string().parse(params.id));
	const sha256 = z.string().parse(params.sha256);

	const userId = locals.user?._id ?? locals.sessionId;

	// check if the conv id is in the allowed conversations
	const allowedConv = await collections.allowedConversations.findOne({
		convId: convId,
	});

	// check user
	if (!userId && !allowedConv) {
		throw error(401, "Unauthorized");
	}

	// check if the user has access to the conversation
	const conv = await collections.conversations.findOne({
		_id: convId,
		...authCondition(locals),
	});

	if (!conv && !allowedConv) {
		throw error(404, "Conversation not found");
	}

	const fileId = collections.bucket.find({ filename: `${convId.toString()}-${sha256}` });

	let mime;

	const content = await fileId.next().then(async (file) => {
		if (!file) {
			throw error(404, "File not found");
		}

		if (file.metadata?.conversation !== convId.toString()) {
			throw error(403, "You don't have access to this file.");
		}

		mime = file.metadata?.mime;

		const fileStream = collections.bucket.openDownloadStream(file._id);

		const fileBuffer = await new Promise<Buffer>((resolve, reject) => {
			const chunks: Uint8Array[] = [];
			fileStream.on("data", (chunk) => chunks.push(chunk));
			fileStream.on("error", reject);
			fileStream.on("end", () => resolve(Buffer.concat(chunks)));
		});

		return fileBuffer;
	});

	return new Response(content, {
		headers: {
			"Content-Type": mime ?? "application/octet-stream",
		},
	});
};
