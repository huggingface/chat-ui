import { collections } from "$lib/server/database";
import type { Assistant } from "$lib/types/Assistant";
import type { User } from "$lib/types/User";
import { generateQueryTokens } from "$lib/utils/searchTokens.js";
import type { Filter } from "mongodb";
import { env } from "$env/dynamic/private";
import { ReviewStatus } from "$lib/types/Review";

const NUM_PER_PAGE = 24;

export async function GET({ url, locals }) {
	const modelId = url.searchParams.get("modelId");
	const pageIndex = parseInt(url.searchParams.get("p") ?? "0");
	const username = url.searchParams.get("user");
	const query = url.searchParams.get("q")?.trim() ?? null;
	const showUnfeatured = url.searchParams.get("showUnfeatured") === "true";
	const createdByCurrentUser = locals.user?.username && locals.user.username === username;

	let user: Pick<User, "_id"> | null = null;
	if (username) {
		user = await collections.users.findOne<Pick<User, "_id">>(
			{ username },
			{ projection: { _id: 1 } }
		);
		if (!user) {
			return Response.json({ message: `User "${username}" doesn't exist` }, { status: 404 });
		}
	}

	// if we require featured assistants, that we are not on a user page and we are not an admin who wants to see unfeatured assistants, we show featured assistants
	let shouldBeFeatured = {};

	if (env.REQUIRE_FEATURED_ASSISTANTS === "true" && !(locals.user?.isAdmin && showUnfeatured)) {
		if (!user) {
			// only show featured assistants on the community page
			shouldBeFeatured = { review: ReviewStatus.APPROVED };
		} else if (!createdByCurrentUser) {
			// on a user page show assistants that have been approved or are pending
			shouldBeFeatured = { review: { $in: [ReviewStatus.APPROVED, ReviewStatus.PENDING] } };
		}
	}
	// fetch the top assistants sorted by user count from biggest to smallest, filter out all assistants with only 1 users. filter by model too if modelId is provided
	const filter: Filter<Assistant> = {
		...(modelId && { modelId }),
		...(user && { createdById: user._id }),
		...(query && { searchTokens: { $all: generateQueryTokens(query) } }),
		...shouldBeFeatured,
	};
	const assistants = await collections.assistants
		.find(filter)
		.skip(NUM_PER_PAGE * pageIndex)
		.sort({ userCount: -1 })
		.limit(NUM_PER_PAGE)
		.toArray();

	const numTotalItems = await collections.assistants.countDocuments(filter);

	return Response.json({
		assistants,
		selectedModel: modelId ?? "",
		numTotalItems,
		numItemsPerPage: NUM_PER_PAGE,
		query,
	});
}
