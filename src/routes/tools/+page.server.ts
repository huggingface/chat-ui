import { Database, collections } from "$lib/server/database.js";
import { SortKey } from "$lib/types/Assistant.js";
import type { CommunityToolDB } from "$lib/types/Tool.js";
import type { User } from "$lib/types/User.js";
import { generateQueryTokens } from "$lib/utils/searchTokens.js";
import { error } from "@sveltejs/kit";
import type { Filter } from "mongodb";

const NUM_PER_PAGE = 24;

export const load = async ({ url, locals }) => {
	const username = url.searchParams.get("user");
	const query = url.searchParams.get("q")?.trim() ?? null;

	const pageIndex = parseInt(url.searchParams.get("p") ?? "0");
	const sort = url.searchParams.get("sort")?.trim() ?? SortKey.TRENDING;
	const createdByCurrentUser = locals.user?.username && locals.user.username === username;

	let user: Pick<User, "_id"> | null = null;
	if (username) {
		user = await collections.users.findOne<Pick<User, "_id">>(
			{ username },
			{ projection: { _id: 1 } }
		);
		if (!user) {
			throw error(404, `User "${username}" doesn't exist`);
		}
	}

	const shouldBeFeatured = !!(!createdByCurrentUser && user?._id);

	const filter: Filter<CommunityToolDB> = {
		...(shouldBeFeatured && { featured: true }),
		...(user && { createdById: user._id }),
		...(query && { searchTokens: { $all: generateQueryTokens(query) } }),
	};

	const tools = await Database.getInstance()
		.getCollections()
		.tools.find(filter)
		.skip(NUM_PER_PAGE * pageIndex)
		.sort({
			...(sort === SortKey.TRENDING && { last24HoursUseCount: -1 }),
			useCount: -1,
		})
		.limit(NUM_PER_PAGE)
		.toArray();

	const numTotalItems = await Database.getInstance().getCollections().tools.countDocuments(filter);

	return {
		tools: JSON.parse(JSON.stringify(tools)) as CommunityToolDB[],
		numTotalItems,
		numItemsPerPage: NUM_PER_PAGE,
		query,
		sort,
	};
};
