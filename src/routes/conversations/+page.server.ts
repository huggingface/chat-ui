import { base } from "$app/paths";
import { authCondition } from "$lib/server/auth";
import { Database } from "$lib/server/database";
import { redirect } from "@sveltejs/kit";

export const actions = {
	async delete({ locals }) {
		// double check we have a user to delete conversations for
		if (locals.user?._id || locals.sessionId) {
			await Database.getInstance().getCollections().conversations.deleteMany({
				...authCondition(locals),
			});
		}

		throw redirect(303, `${base}/`);
	},
};
