import { base } from "$app/paths";
import { authCondition } from "$lib/server/auth.js";
import { collections } from "$lib/server/database.js";
import { models } from "$lib/server/models";
import { redirect } from "@sveltejs/kit";

export async function load({ params, locals }) {
	const model = models.find(({ id }) => id === params.model);

	if (!model || model.unlisted) {
		throw redirect(302, `${base}/`);
	}

	if (locals.user?._id ?? locals.sessionId) {
		await collections.settings.updateOne(
			authCondition(locals),
			{
				$set: {
					activeModel: model.id,
					updatedAt: new Date(),
				},
				$setOnInsert: {
					createdAt: new Date(),
				},
			},
			{
				upsert: true,
			}
		);

		throw redirect(302, `${base}/`);
	}
}
