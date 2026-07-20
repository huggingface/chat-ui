import { redirect, type RequestHandler } from "@sveltejs/kit";

import { base } from "$app/paths";
import { collections } from "$lib/server/database";
import { config } from "$lib/server/config";
import {
	getShareThumbnailPng,
	shareThumbnailPrompt,
} from "$lib/server/shareThumbnail/shareThumbnail";

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

	const png = await getShareThumbnailPng({
		prompt: shareThumbnailPrompt(sharedConversation),
		isHuggingChat: config.isHuggingChat,
		appName: config.PUBLIC_APP_NAME,
	});

	// Shared conversations are immutable snapshots, so long cache lifetimes are safe
	return new Response(new Uint8Array(png), {
		headers: {
			"Content-Type": "image/png",
			"Cache-Control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=604800",
		},
	});
}) satisfies RequestHandler;
