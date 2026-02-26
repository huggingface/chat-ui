import type { PageServerLoad } from "./$types";
import { collections } from "$lib/server/database";
import { config } from "$lib/server/config";
import { base } from "$app/paths";

export const load: PageServerLoad = async ({ params, url }) => {
	const shareId = params.id;

	const shared = await collections.sharedConversations.findOne(
		{ _id: shareId },
		{ projection: { title: 1, model: 1 } }
	);

	const shareTitle = shared?.title || "Shared Conversation";
	const shareModel = shared?.model ?? "";
	const origin = config.get("PUBLIC_ORIGIN") || url.origin;
	const appName = config.get("PUBLIC_APP_NAME") || "HuggingChat";

	return {
		shareTitle,
		shareModel,
		shareId,
		appName,
		ogImageUrl: `${origin}${base}/r/${shareId}/thumbnail.png`,
	};
};
