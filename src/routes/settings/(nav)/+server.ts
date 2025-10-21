import { collections } from "$lib/server/database";
import { z } from "zod";
import { authCondition } from "$lib/server/auth";
import { DEFAULT_SETTINGS, type SettingsEditable } from "$lib/types/Settings";

export async function POST({ request, locals }) {
	const body = await request.json();

	const { welcomeModalSeen, ...settings } = z
		.object({
			shareConversationsWithModelAuthors: z
				.boolean()
				.default(DEFAULT_SETTINGS.shareConversationsWithModelAuthors),
			welcomeModalSeen: z.boolean().optional(),
			activeModel: z.string().default(DEFAULT_SETTINGS.activeModel),
			customPrompts: z.record(z.string()).default({}),
			multimodalOverrides: z.record(z.boolean()).default({}),
			modelParameters: z
				.record(
					z.object({
						temperature: z.number().min(0).max(2).optional(),
						max_tokens: z.number().int().positive().optional(),
					})
				)
				.default({}),
			disableStream: z.boolean().default(false),
			directPaste: z.boolean().default(false),
			hidePromptExamples: z.record(z.boolean()).default({}),
		})
		.parse(body) satisfies SettingsEditable;

	await collections.settings.updateOne(
		authCondition(locals),
		{
			$set: {
				...settings,
				...(welcomeModalSeen && { welcomeModalSeenAt: new Date() }),
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
