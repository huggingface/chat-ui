import { z } from "zod";
import { collections } from "$lib/server/database.js";
import { defaultModel, modelsPublicData } from "$lib/server/models";

export async function PATCH({ locals, request }) {
	const json = await request.json();

	const { ethicsModalAccepted, ...settings } = z
		.object({
			shareConversationsWithModelAuthors: z.boolean().default(true),
			ethicsModalAccepted: z.boolean().optional(),
			activeModel: z
				.enum([modelsPublicData[0].name, ...modelsPublicData.slice(1).map((m) => m.name)])
				.default(defaultModel.name),
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
