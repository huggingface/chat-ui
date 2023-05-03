import { collections } from "$lib/server/database.js";
import { subMinutes } from "date-fns";
import { z } from "zod";

export async function PATCH({ locals, request }) {
	const json = await request.json();

	const settings = z
		.object({
			shareConversationsWithModelAuthors: z.boolean().default(true),
			ethicsModalAcceptedAt: z.optional(z.date({ coerce: true }).min(subMinutes(new Date(), 5))),
		})
		.parse(json);

	await collections.settings.updateOne(
		{
			sessionId: locals.sessionId,
		},
		{
			$set: {
				...settings,
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
