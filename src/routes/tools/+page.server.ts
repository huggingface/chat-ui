import { env } from "$env/dynamic/private";
import { authCondition } from "$lib/server/auth.js";
import { Database, collections } from "$lib/server/database.js";
import { toolFromConfigs } from "$lib/server/tools/index.js";
import { SortKey } from "$lib/types/Assistant.js";
import { ReviewStatus } from "$lib/types/Review";
import type { CommunityToolDB } from "$lib/types/Tool.js";
import type { User } from "$lib/types/User.js";
import { generateQueryTokens, generateSearchTokens } from "$lib/utils/searchTokens.js";
import { error } from "@sveltejs/kit";
import { ObjectId, type Filter } from "mongodb";

const NUM_PER_PAGE = 16;

export const load = async ({ url, locals }) => {
	if (env.COMMUNITY_TOOLS !== "true") {
		error(403, "Community tools are not enabled");
	}

	const username = url.searchParams.get("user");
	const query = url.searchParams.get("q")?.trim() ?? null;

	const pageIndex = parseInt(url.searchParams.get("p") ?? "0");
	const sort = url.searchParams.get("sort")?.trim() ?? SortKey.TRENDING;
	const createdByCurrentUser = locals.user?.username && locals.user.username === username;
	const activeOnly = url.searchParams.get("active") === "true";
	const showUnfeatured = url.searchParams.get("showUnfeatured") === "true";

	let user: Pick<User, "_id"> | null = null;
	if (username) {
		user = await collections.users.findOne<Pick<User, "_id">>(
			{ username },
			{ projection: { _id: 1 } }
		);
		if (!user) {
			error(404, `User "${username}" doesn't exist`);
		}
	}

	const settings = await collections.settings.findOne(authCondition(locals));

	if (!settings && activeOnly) {
		error(404, "No user settings found");
	}

	const queryTokens = !!query && generateQueryTokens(query);

	const filter: Filter<CommunityToolDB> = {
		...(!createdByCurrentUser &&
			!activeOnly &&
			!(locals.user?.isAdmin && showUnfeatured) && { review: ReviewStatus.APPROVED }),
		...(user && { createdById: user._id }),
		...(queryTokens && { searchTokens: { $all: queryTokens } }),
		...(activeOnly && {
			_id: {
				$in: (settings?.tools ?? []).map((key) => {
					return new ObjectId(key);
				}),
			},
		}),
	};

	const communityTools = await Database.getInstance()
		.getCollections()
		.tools.find(filter)
		.skip(NUM_PER_PAGE * pageIndex)
		.sort({
			...(sort === SortKey.TRENDING && { last24HoursUseCount: -1 }),
			useCount: -1,
		})
		.limit(NUM_PER_PAGE)
		.toArray();

	const configTools = toolFromConfigs
		.filter((tool) => !tool?.isHidden)
		.filter((tool) => {
			if (queryTokens) {
				return generateSearchTokens(tool.displayName).some((token) =>
					queryTokens.some((queryToken) => queryToken.test(token))
				);
			}
			return true;
		});

	const tools = [...(pageIndex == 0 && !username ? configTools : []), ...communityTools];

	const numTotalItems =
		(await Database.getInstance().getCollections().tools.countDocuments(filter)) +
		toolFromConfigs.length;

	return {
		tools: JSON.parse(JSON.stringify(tools)) as CommunityToolDB[],
		numTotalItems,
		numItemsPerPage: NUM_PER_PAGE,
		query,
		sort,
		showUnfeatured,
	};
};
