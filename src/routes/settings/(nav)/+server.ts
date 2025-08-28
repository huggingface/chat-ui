import { collections } from "$lib/server/database";
import { z } from "zod";
import { authCondition } from "$lib/server/auth";
import { DEFAULT_SETTINGS, type SettingsEditable } from "$lib/types/Settings";
import { ObjectId } from "mongodb";

export async function POST({ request, locals }) {
	const body = await request.json();

	const { ethicsModalAccepted, ...settings } = z
		.object({
			shareConversationsWithModelAuthors: z
				.boolean()
				.default(DEFAULT_SETTINGS.shareConversationsWithModelAuthors),
			hideEmojiOnSidebar: z.boolean().default(DEFAULT_SETTINGS.hideEmojiOnSidebar),
			ethicsModalAccepted: z.boolean().optional(),
			activeModel: z.string().default(DEFAULT_SETTINGS.activeModel),
			customPrompts: z.record(z.string()).default({}),
			disableStream: z.boolean().default(false),
			directPaste: z.boolean().default(false),
		})
		.parse(body) satisfies SettingsEditable;

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
