import { collections } from "$lib/server/database";
import { authCondition } from "$lib/server/auth";

export async function GET({ locals }) {
	if (locals.user?._id || locals.sessionId) {
		const res = await collections.conversations
			.find({
				...authCondition(locals),
			})
			.toArray();

		return Response.json(res);
	} else {
		return Response.json({ message: "Must have session cookie" }, { status: 401 });
	}
}
