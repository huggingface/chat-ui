import { collections } from "$lib/server/database";

export async function GET({ locals }) {
	if (locals.user?._id || locals.sessionId) {
		const res = await collections.conversations
			.find({
				...(locals.user ? { userId: locals.user._id } : { sessionId: locals.sessionId }),
			})
			.toArray();

		return Response.json(res);
	} else {
		return Response.error();
	}
}
