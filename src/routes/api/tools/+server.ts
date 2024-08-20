import { collections } from "$lib/server/database.js";
import { toolFromConfigs } from "$lib/server/tools/index.js";
import type { CommunityToolDB } from "$lib/types/Tool.js";
import { generateQueryTokens, generateSearchTokens } from "$lib/utils/searchTokens.js";
import type { Filter } from "mongodb";

export async function GET({ url, locals }) {
	// XXX: feature_flag_tools
	if (!locals.user?.isEarlyAccess) {
		return new Response("Not early access", { status: 403 });
	}

	const query = url.searchParams.get("q")?.trim() ?? null;
	const queryTokens = !!query && generateQueryTokens(query);

	const filter: Filter<CommunityToolDB> = {
		...(queryTokens && { searchTokens: { $all: queryTokens } }),
		featured: true,
	};

	const matchingCommunityTools = await collections.tools
		.find(filter)
		.project({ _id: 1, displayName: 1 })
		.limit(5)
		.toArray();

	const matchingConfigTools = toolFromConfigs
		.filter((tool) => !tool?.isHidden)
		.filter((tool) => {
			if (queryTokens) {
				return generateSearchTokens(tool.displayName).some((token) =>
					queryTokens.some((queryToken) => queryToken.test(token))
				);
			}
			return true;
		})
		.map((tool) => ({
			_id: tool._id.toString(),
			displayName: tool.displayName,
		}));

	return Response.json([...matchingConfigTools, ...matchingCommunityTools].slice(0, 5));
}
