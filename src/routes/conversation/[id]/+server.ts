import { authCondition } from "$lib/server/auth";
import { collections } from "$lib/server/database";
import { generateMessage } from "$lib/server/message";
import { error } from "@sveltejs/kit";
import { ObjectId } from "mongodb";
import { z } from "zod";

export async function POST(requestEvent) {
	const { request } = requestEvent;

	const json = await request.json();

	const { stream, response } = await generateMessage(json, requestEvent, {
		// retryMessageId: messageId as Message["id"],
	});

	// Todo: maybe we should wait for the message to be saved before ending the response - in case of errors
	return new Response(
		stream,
		response && {
			headers: Object.fromEntries(response.headers.entries()),
			status: response.status,
			statusText: response.statusText,
		}
	);
}

export async function DELETE({ locals, params }) {
	const convId = new ObjectId(params.id);

	const conv = await collections.conversations.findOne({
		_id: convId,
		...authCondition(locals),
	});

	if (!conv) {
		throw error(404, "Conversation not found");
	}

	await collections.conversations.deleteOne({ _id: conv._id });

	return new Response();
}

export async function PATCH({ request, locals, params }) {
	const { title } = z
		.object({ title: z.string().trim().min(1).max(100) })
		.parse(await request.json());

	const convId = new ObjectId(params.id);

	const conv = await collections.conversations.findOne({
		_id: convId,
		...authCondition(locals),
	});

	if (!conv) {
		throw error(404, "Conversation not found");
	}

	await collections.conversations.updateOne(
		{
			_id: convId,
		},
		{
			$set: {
				title,
			},
		}
	);

	return new Response();
}
