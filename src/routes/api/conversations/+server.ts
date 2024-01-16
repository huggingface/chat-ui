import { collections } from "$lib/server/database";
import { authCondition } from "$lib/server/auth";

export async function GET({ locals }) {
	if (locals.user?._id || locals.sessionId) {
		const convs = await collections.conversations
			.find({
				...authCondition(locals),
			})
			.sort({ updatedAt: -1 })
			.toArray();

		const res = convs.map((conv) => ({
			id: conv._id,
			title: conv.title,
			updatedAt: conv.updatedAt,
			modelId: conv.model,
		}));

		return Response.json(res);
	} else {
		return Response.json({ message: "Must have session cookie" }, { status: 401 });
	}
}
