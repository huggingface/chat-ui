import { base } from "$app/paths";
import { collections } from "$lib/server/database";
import { redirect } from "@sveltejs/kit";
import { z } from "zod";
import { defaultModel, models, validateModel } from "$lib/server/models";
import { authCondition } from "$lib/server/auth";
import { DEFAULT_SETTINGS } from "$lib/constants.js";

export const actions = {
	default: async function ({ request, locals }) {
		const formData = await request.formData();

		const { ethicsModalAccepted, ...settings } = z
			.object({
				shareConversationsWithModelAuthors: z
					.boolean({ coerce: true })
					.default(DEFAULT_SETTINGS.shareConversationsWithModelAuthors),
				ethicsModalAccepted: z.boolean({ coerce: true }).optional(),
				activeModel: validateModel(models),
			})
			.parse({
				shareConversationsWithModelAuthors: formData.get("shareConversationsWithModelAuthors"),
				ethicsModalAccepted: formData.get("ethicsModalAccepted"),
				activeModel: formData.get("activeModel") ?? defaultModel.id,
			});

		await collections.settings.updateOne(
			authCondition(locals),
			{
				$set: {
					...settings,
					...(ethicsModalAccepted && { ethicsModalAcceptedAt: new Date() }),
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

		throw redirect(303, request.headers.get("referer") || base || "/");
	},
};
