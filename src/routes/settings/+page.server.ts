import { base } from "$app/paths";
import { collections } from "$lib/server/database.js";
import { redirect } from "@sveltejs/kit";
import { z } from "zod";

export const actions = {
	default: async function ({ request, locals }) {
		const formData = await request.formData();

		const existingSettings = await collections.settings.findOne({ sessionId: locals.sessionId });

		const { ethicsModalAccepted, ...settings } = z
			.object({
				shareConversationsWithModelAuthors: z
					.boolean({ coerce: true })
					.default(existingSettings?.shareConversationsWithModelAuthors ?? true),
				ethicsModalAccepted: z.boolean({ coerce: true }).optional(),
			})
			.parse({
				// `undefined` is important here vs `null`, otherwise `.default()` will not work
				shareConversationsWithModelAuthors:
					formData.get("shareConversationsWithModelAuthors") ?? undefined,
				ethicsModalAccepted: formData.get("ethicsModalAccepted") ?? undefined,
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
