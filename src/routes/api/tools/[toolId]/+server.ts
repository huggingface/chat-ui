import { env } from "$env/dynamic/private";
import { collections } from "$lib/server/database.js";
import { toolFromConfigs } from "$lib/server/tools/index.js";
import { ReviewStatus } from "$lib/types/Review";
import type { CommunityToolDB } from "$lib/types/Tool.js";
import { ObjectId } from "mongodb";

export async function GET({ params }) {
	if (env.COMMUNITY_TOOLS !== "true") {
		return new Response("Community tools are not enabled", { status: 403 });
	}

	const toolId = params.toolId;

	try {
		const configTool = toolFromConfigs.find((el) => el._id.toString() === toolId);
		if (configTool) {
			return Response.json({
				_id: toolId,
				displayName: configTool.displayName,
				color: configTool.color,
				icon: configTool.icon,
				createdByName: undefined,
			});
		} else {
			// try community tools
			const tool = await collections.tools
				.findOne<CommunityToolDB>({ _id: new ObjectId(toolId) })
				.then((tool) =>
					tool
						? {
								_id: tool._id.toString(),
								displayName: tool.displayName,
								color: tool.color,
								icon: tool.icon,
								createdByName: tool.createdByName,
								review: tool.review,
							}
						: undefined
				);

			if (!tool || tool.review !== ReviewStatus.APPROVED) {
				return new Response(`Tool "${toolId}" not found`, { status: 404 });
			}

			return Response.json(tool);
		}
	} catch (e) {
		return new Response(`Tool "${toolId}" not found`, { status: 404 });
	}
}

export async function DELETE({ params, locals }) {
	const tool = await collections.tools.findOne({ _id: new ObjectId(params.toolId) });

	if (!tool) {
		return new Response("Tool not found", { status: 404 });
	}

	if (
		tool.createdById.toString() !== (locals.user?._id ?? locals.sessionId).toString() &&
		!locals.user?.isAdmin
	) {
		return new Response("You are not the creator of this tool", { status: 403 });
	}

	await collections.tools.deleteOne({ _id: tool._id });

	// Remove the tool from all users' settings
	await collections.settings.updateMany(
		{
			tools: { $in: [tool._id.toString()] },
		},
		{
			$pull: { tools: tool._id.toString() },
		}
	);

	// Remove the tool from all assistants
	await collections.assistants.updateMany(
		{
			tools: { $in: [tool._id.toString()] },
		},
		{
			$pull: { tools: tool._id.toString() },
		}
	);

	return new Response("Tool deleted", { status: 200 });
}
