import { collections } from "$lib/server/database";
import { z } from "zod";
import { authCondition } from "$lib/server/auth";
import { DEFAULT_SETTINGS, type SettingsEditable } from "$lib/types/Settings";
import { toolFromConfigs } from "$lib/server/tools/index.js";
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
			tools: z.array(z.string()).optional(),
			disableStream: z.boolean().default(false),
		})
		.parse(body) satisfies SettingsEditable;

	// only allow tools to be set to community tools if user is early access
	// XXX: feature_flag_tools
	if (!locals.user?.isEarlyAccess) {
		settings.tools = settings.tools?.filter((toolId) => {
			return toolFromConfigs.some((tool) => tool._id.toString() === toolId);
		});
	}

	// make sure all tools exist
	if (settings.tools) {
		settings.tools = await collections.tools
			.find({ _id: { $in: settings.tools.map((toolId) => new ObjectId(toolId)) } })
			.project({ _id: 1 })
			.toArray()
			.then((tools) => tools.map((tool) => tool._id.toString()));
	}

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
