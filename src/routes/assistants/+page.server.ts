import { base } from "$app/paths";
import { ENABLE_ASSISTANTS } from "$env/static/private";
import { collections } from "$lib/server/database.js";
import type { Assistant } from "$lib/types/Assistant";
import type { User } from "$lib/types/User";
import { error, redirect } from "@sveltejs/kit";
import type { Filter } from "mongodb";

const NUM_PER_PAGE = 24;

export const load = async ({ url, locals }) => {
	if (!ENABLE_ASSISTANTS) {
		throw redirect(302, `${base}/`);
	}

	const modelId = url.searchParams.get("modelId");
	const pageIndex = parseInt(url.searchParams.get("p") ?? "0");
	const username = url.searchParams.get("user");
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

	// fetch the top assistants sorted by user count from biggest to smallest, filter out all assistants with only 1 users. filter by model too if modelId is provided
	const filter: Filter<Assistant> = {
		...(modelId && { modelId }),
		...(!createdByCurrentUser && { userCount: { $gt: 1 } }),
		...(user ? { createdById: user._id } : { featured: true }),
	};
	const assistants = await collections.assistants
		.find(filter)
		.skip(NUM_PER_PAGE * pageIndex)
		.sort({ userCount: -1 })
		.limit(NUM_PER_PAGE)
		.toArray();

	const numTotalItems = await collections.assistants.countDocuments(filter);

	return {
		assistants: JSON.parse(JSON.stringify(assistants)) as Array<Assistant>,
		selectedModel: modelId ?? "",
		numTotalItems,
		numItemsPerPage: NUM_PER_PAGE,
	};
};
