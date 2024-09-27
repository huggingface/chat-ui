import { env } from "$env/dynamic/private";
import { collections } from "$lib/server/database.js";
import { toolFromConfigs } from "$lib/server/tools/index.js";
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
								featured: tool.featured,
						  }
						: undefined
				);

			if (!tool || !tool.featured) {
				return new Response(`Tool "${toolId}" not found`, { status: 404 });
			}

			return Response.json(tool);
		}
	} catch (e) {
		return new Response(`Tool "${toolId}" not found`, { status: 404 });
	}
}
