import { env } from "$env/dynamic/private";
import { collections } from "$lib/server/database.js";
import { toolFromConfigs } from "$lib/server/tools/index.js";
import type { BaseTool, CommunityToolDB } from "$lib/types/Tool.js";
import { generateQueryTokens, generateSearchTokens } from "$lib/utils/searchTokens.js";
import type { Filter } from "mongodb";
import { ReviewStatus } from "$lib/types/Review";
export async function GET({ url }) {
	if (env.COMMUNITY_TOOLS !== "true") {
		return new Response("Community tools are not enabled", { status: 403 });
	}

	const query = url.searchParams.get("q")?.trim() ?? null;
	const queryTokens = !!query && generateQueryTokens(query);

	const filter: Filter<CommunityToolDB> = {
		...(queryTokens && { searchTokens: { $all: queryTokens } }),
		review: ReviewStatus.APPROVED,
	};

	const matchingCommunityTools = await collections.tools
		.find(filter)
		.project<Pick<BaseTool, "_id" | "displayName" | "color" | "icon">>({
			_id: 1,
			displayName: 1,
			color: 1,
			icon: 1,
			createdByName: 1,
		})
		.sort({ useCount: -1 })
		.limit(5)
		.toArray();

	const matchingConfigTools = toolFromConfigs
		.filter((tool) => !tool?.isHidden)
		.filter((tool) => tool.name !== "websearch") // filter out websearch tool from config tools since its added separately
		.filter((tool) => {
			if (queryTokens) {
				return generateSearchTokens(tool.displayName).some((token) =>
					queryTokens.some((queryToken) => queryToken.test(token))
				);
			}
			return true;
		})
		.map((tool) => ({
			_id: tool._id,
			displayName: tool.displayName,
			color: tool.color,
			icon: tool.icon,
			createdByName: undefined,
		}));

	const tools = [...matchingConfigTools, ...matchingCommunityTools] satisfies Array<
		Pick<BaseTool, "_id" | "displayName" | "color" | "icon"> & { createdByName?: string }
	>;

	return Response.json(tools.map((tool) => ({ ...tool, _id: tool._id.toString() })).slice(0, 5));
}
