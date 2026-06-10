import { redirect, type RequestHandler } from "@sveltejs/kit";

import { base } from "$app/paths";
import { collections } from "$lib/server/database";
import { config } from "$lib/server/config";
import { convertLegacyConversation } from "$lib/utils/tree/convertLegacyConversation";
import { extractFirstUserPrompt, renderableThumbnailText } from "$lib/utils/sharePreviewText";
import { renderShareThumbnailPng } from "./shareThumbnail";

// Social-preview thumbnail for shared conversations. Only shared conversations
// (public-by-design snapshots with 7-char nanoid ids) are ever rendered here;
// private conversations are not reachable through this endpoint.
export const GET: RequestHandler = (async ({ params }) => {
	const id = params.id ?? "";

	if (id.length !== 7) {
		redirect(302, `${base}/`);
	}

	const sharedConversation = await collections.sharedConversations.findOne({ _id: id });

	if (!sharedConversation) {
		redirect(302, `${base}/`);
	}

	const { messages, rootMessageId } = convertLegacyConversation(sharedConversation);

	// Prefer the first user prompt; fall back to the title, then to the generic card
	const prompt =
		renderableThumbnailText(extractFirstUserPrompt(messages, rootMessageId), 240) ||
		renderableThumbnailText(sharedConversation.title ?? "", 120);

	const png = await renderShareThumbnailPng({
		prompt,
		isHuggingChat: config.isHuggingChat,
		appName: config.PUBLIC_APP_NAME,
	});

	// Shared conversations are immutable snapshots, so long cache lifetimes are safe
	return new Response(png, {
		headers: {
			"Content-Type": "image/png",
			"Cache-Control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=604800",
		},
	});
}) satisfies RequestHandler;
