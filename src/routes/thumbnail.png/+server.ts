import { type RequestHandler } from "@sveltejs/kit";

import { config } from "$lib/server/config";
import { getShareThumbnailPng } from "$lib/server/shareThumbnail/shareThumbnail";
import { renderableThumbnailText } from "$lib/utils/sharePreviewText";
import { promptFromLinkParams } from "$lib/utils/urlParams";

// Social-preview thumbnail for home-page deep links (?q= / ?prompt=). The same
// card the shared-conversation endpoint renders, but the prompt comes straight
// from the query string instead of a stored conversation.
//
// The prompt text is fully attacker-controllable here, but the render pipeline
// treats it as inert text: it is sanitized and length-capped by
// renderableThumbnailText, the satori element tree is built from plain objects
// (never parsed as HTML), and no network calls happen at render time — so
// rendering query-string text is as safe as rendering a stored share
// (see shareThumbnail.ts / sharePreviewText.ts). Distinct prompts are bounded
// by an LRU cache shared with the share endpoint; an empty/non-renderable
// prompt falls back to the generic card.
export const GET: RequestHandler = (async ({ url }) => {
	const prompt = renderableThumbnailText(promptFromLinkParams(url.searchParams), 240);

	const png = await getShareThumbnailPng({
		prompt,
		isHuggingChat: config.isHuggingChat,
		appName: config.PUBLIC_APP_NAME,
	});

	// The card is a pure function of the (sanitized) prompt in the URL, so the
	// same link always yields the same image — long cache lifetimes are safe and
	// let link unfurlers hit the CDN instead of re-rendering.
	return new Response(png, {
		headers: {
			"Content-Type": "image/png",
			"Cache-Control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=604800",
		},
	});
}) satisfies RequestHandler;
