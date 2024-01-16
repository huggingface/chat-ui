import { collections } from "$lib/server/database";
import { authCondition } from "$lib/server/auth";
import { z } from "zod";
import { ObjectId } from "mongodb";

export async function GET({ locals, params }) {
	const id = z.string().parse(params.id);
	const convId = new ObjectId(id);

	if (locals.user?._id || locals.sessionId) {
		const conv = await collections.conversations.findOne({
			_id: convId,
			...authCondition(locals),
		});

		if (conv) {
			return Response.json(conv);
		} else {
			return Response.json({ message: "Conversation not found" }, { status: 404 });
		}
	} else {
		return Response.json({ message: "Must have session cookie" }, { status: 401 });
	}
}
