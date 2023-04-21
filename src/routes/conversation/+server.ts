import type { RequestHandler } from "./$types";
import { collections } from "$lib/server/database";
import { ObjectId } from "mongodb";
import { redirect } from "@sveltejs/kit";
import { base } from "$app/paths";

export const POST: RequestHandler = async (input) => {
	const res = await collections.conversations.insertOne({
		_id: new ObjectId(),
		title:
			"Untitled " +
			((await collections.conversations.countDocuments({ sessionId: input.locals.sessionId })) + 1),
		messages: [],
		createdAt: new Date(),
		updatedAt: new Date(),
		sessionId: input.locals.sessionId,
	});

	return new Response(
		JSON.stringify({
			conversationId: res.insertedId.toString(),
		}),
		{ headers: { "Content-Type": "application/json" } }
	);
};

export const GET: RequestHandler = async () => {
	throw redirect(301, base || "/");
};
