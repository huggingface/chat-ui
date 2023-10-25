import { base } from "$app/paths";
import { collections } from "$lib/server/database";
import { redirect } from "@sveltejs/kit";
import { z } from "zod";
import { models, validateModel } from "$lib/server/models";
import { authCondition } from "$lib/server/auth";
import { DEFAULT_SETTINGS } from "$lib/types/Settings";

const booleanFormObject = z
	.union([z.literal("true"), z.literal("on"), z.literal("false"), z.null()])
	.transform((value) => {
		return value === "true" || value === "on";
	});

export const actions = {
	default: async function ({ request, locals }) {
		const formData = await request.formData();

		const { ethicsModalAccepted, ...settings } = z
			.object({
				shareConversationsWithModelAuthors: booleanFormObject,
				hideEmojiOnSidebar: booleanFormObject,
				ethicsModalAccepted: z.boolean({ coerce: true }).optional(),
				activeModel: validateModel(models),
				customPrompts: z.record(z.string()).default({}),
			})
			.parse({
				hideEmojiOnSidebar: formData.get("hideEmojiOnSidebar"),
				shareConversationsWithModelAuthors: formData.get("shareConversationsWithModelAuthors"),
				ethicsModalAccepted: formData.get("ethicsModalAccepted"),
				activeModel: formData.get("activeModel") ?? DEFAULT_SETTINGS.activeModel,
				customPrompts: JSON.parse(formData.get("customPrompts")?.toString() ?? "{}"),
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
		throw redirect(303, request.headers.get("referer") || `${base}/`);
	},
};
