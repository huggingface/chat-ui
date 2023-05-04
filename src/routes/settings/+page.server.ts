import { base } from "$app/paths";
import { collections } from "$lib/server/database";
import { redirect } from "@sveltejs/kit";
import { z } from "zod";
import { defaultModel, models } from "$lib/server/models";

export const actions = {
	default: async function ({ request, locals }) {
		const formData = await request.formData();

		const { ethicsModalAccepted, ...settings } = z
			.object({
				shareConversationsWithModelAuthors: z.boolean({ coerce: true }).default(true),
				ethicsModalAccepted: z.boolean({ coerce: true }).optional(),
				activeModel: z.enum([models[0].name, ...models.slice(1).map((m) => m.name)]),
			})
			.parse({
				shareConversationsWithModelAuthors: formData.get("shareConversationsWithModelAuthors"),
				ethicsModalAccepted: formData.get("ethicsModalAccepted"),
				activeModel: formData.get("activeModel") ?? defaultModel.name,
			});

		await collections.settings.updateOne(
			{
				sessionId: locals.sessionId,
			},
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
