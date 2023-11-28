import { base } from "$app/paths";
import { collections } from "$lib/server/database";
import { redirect } from "@sveltejs/kit";
import { z } from "zod";
import { models, validateModel } from "$lib/server/models";
import { authCondition } from "$lib/server/auth";
import { DEFAULT_SETTINGS } from "$lib/types/Settings";

export async function POST({ request, locals }) {
	const body = await request.json();

	console.log("settings update");
	const { ethicsModalAccepted, ...settings } = z
		.object({
			shareConversationsWithModelAuthors: z
				.boolean()
				.default(DEFAULT_SETTINGS.shareConversationsWithModelAuthors),
			hideEmojiOnSidebar: z.boolean().default(DEFAULT_SETTINGS.hideEmojiOnSidebar),
			ethicsModalAccepted: z.boolean().optional(),
			activeModel: validateModel(models).default(DEFAULT_SETTINGS.activeModel),
			customPrompts: z.record(z.string()).default({}),
		})
		.parse(body);

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
	// return ok response
	return new Response();
}
