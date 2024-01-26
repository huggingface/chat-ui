import { base } from "$app/paths";
import { ENABLE_ASSISTANTS } from "$env/static/private";
import { collections } from "$lib/server/database.js";
import type { Assistant } from "$lib/types/Assistant";
import { redirect } from "@sveltejs/kit";

export const load = async ({ url }) => {
	if (!ENABLE_ASSISTANTS) {
		throw redirect(302, `${base}/`);
	}

	const modelId = url.searchParams.get("modelId");

	// fetch the top 10 assistants sorted by user count from biggest to smallest, filter out all assistants with only 1 users, and only use featured assistants. filter by model too if modelId is provided
	const assistants = await collections.assistants
		.find({ userCount: { $gt: 1 }, modelId: modelId ?? { $exists: true }, featured: true })
		.sort({ userCount: -1 })
		.limit(10)
		.toArray();

	return { assistants: JSON.parse(JSON.stringify(assistants)) as Array<Assistant> };
};
