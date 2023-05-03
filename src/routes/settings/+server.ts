import { collections } from "$lib/server/database.js";
import { z } from "zod";

export async function PATCH({ locals, request }) {
	const json = await request.json();

	const { ethicsModalAccepted, ...settings } = z
		.object({
			shareConversationsWithModelAuthors: z.boolean().default(true),
			ethicsModalAccepted: z.boolean().optional(),
		})
		.parse(json);

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

	return new Response();
}
