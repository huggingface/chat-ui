import { base } from "$app/paths";
import { collections } from "$lib/server/database";
import { redirect } from "@sveltejs/kit";
import { ObjectId } from "mongodb";
import { authCondition } from "$lib/server/auth.js";

export async function load({ params, locals }) {
	try {
		const assistant = await collections.assistants.findOne({
			_id: new ObjectId(params.assistantId),
		});

		if (!assistant) {
			redirect(302, `${base}`);
		}

		if (locals.user?._id ?? locals.sessionId) {
			await collections.settings.updateOne(
				authCondition(locals),
				{
					$set: {
						activeModel: assistant._id.toString(),
						updatedAt: new Date(),
					},
					$push: { assistants: assistant._id },
					$setOnInsert: {
						createdAt: new Date(),
					},
				},
				{
					upsert: true,
				}
			);
		}

		return {
			assistant: JSON.parse(JSON.stringify(assistant)),
		};
	} catch {
		redirect(302, `${base}`);
	}
}
