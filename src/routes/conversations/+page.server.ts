import { base } from "$app/paths";
import { authCondition } from "$lib/server/auth";
import { collections } from "$lib/server/database";
import { redirect } from "@sveltejs/kit";

export const actions = {
	delete: async function ({ locals }) {
		// double check we have a user to delete conversations for
		if (locals.user?._id || locals.sessionId) {
			await collections.conversations.deleteMany({
				...authCondition(locals),
			});
		}

		throw redirect(303, `${base}/`);
	},
};
