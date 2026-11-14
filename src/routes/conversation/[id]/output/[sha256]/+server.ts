import { authCondition } from "$lib/server/auth";
import { collections } from "$lib/server/database";
import { error } from "@sveltejs/kit";
import { ObjectId } from "mongodb";
import { Readable } from "node:stream";
import { z } from "zod";
import type { RequestHandler } from "./$types";
import mimeTypes from "mime-types";
import { parseByteRange } from "$lib/server/files/byteRange";

export const GET: RequestHandler = async ({ locals, params, request }) => {
	const sha256 = z.string().parse(params.sha256);

	const userId = locals.user?._id ?? locals.sessionId;

	// check user
	if (!userId) {
		error(401, "Unauthorized");
	}

	// files are named by the conversation id as the database prints it
	let conversation = params.id;
	if (params.id.length !== 7) {
		const convId = new ObjectId(z.string().parse(params.id));
		conversation = convId.toString();

		// check if the user has access to the conversation
		const conv = await collections.conversations.findOne({
			_id: convId,
			...authCondition(locals),
		});

		if (!conv) {
			error(404, "Conversation not found");
		}
	} else {
		// look for the conversation in shared conversations
		const conv = await collections.sharedConversations.findOne({
			_id: params.id,
		});

		if (!conv) {
			error(404, "Conversation not found");
		}
	}

	const file = await collections.bucket
		.find({ filename: `${conversation}-${sha256}` })
		.limit(1)
		.next();
	if (!file) {
		error(404, "File not found");
	}
	if (file.metadata?.conversation !== conversation) {
		error(403, "You don't have access to this file.");
	}

	const mime: string | undefined = file.metadata?.mime;
	const size = file.length;
	const headers: Record<string, string> = {
		"Content-Type": mime ?? "application/octet-stream",
		"Content-Security-Policy": "default-src 'none'; script-src 'none'; style-src 'none'; sandbox;",
		"Content-Disposition": `attachment; filename="${sha256.slice(0, 8)}.${
			mime ? mimeTypes.extension(mime) || "bin" : "bin"
		}"`,
		"Accept-Ranges": "bytes",
		// The URL names the file by its hash, so its bytes never change; private
		// because reading it needs access to the conversation.
		"Cache-Control": "private, max-age=31536000, immutable",
	};

	// Streamed from GridFS rather than buffered, and by range when asked: the
	// paper reader range-loads a large PDF, so page 1 shows before the rest.
	const range = parseByteRange(request.headers.get("range"), size);
	if (range === "bad") {
		return new Response(null, {
			status: 416,
			headers: { ...headers, "Content-Range": `bytes */${size}` },
		});
	}
	if (size === 0) {
		return new Response(new Uint8Array(), {
			headers: { ...headers, "Content-Length": "0" },
		});
	}
	const [start, end] = range ?? [0, size - 1];
	const stream = collections.bucket.openDownloadStream(file._id, { start, end: end + 1 });
	return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, {
		status: range ? 206 : 200,
		headers: {
			...headers,
			"Content-Length": String(end - start + 1),
			...(range ? { "Content-Range": `bytes ${start}-${end}/${size}` } : {}),
		},
	});
};
