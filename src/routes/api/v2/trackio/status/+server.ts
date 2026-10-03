import { error, type RequestHandler } from "@sveltejs/kit";
import { superjsonResponse } from "$lib/server/api/utils/superjsonResponse";
import { fetchTrackioSpaceStatus } from "$lib/server/trackioSpace";

/** `owner/name`, the only shape a Space id takes. */
const SPACE_ID = /^[A-Za-z0-9][\w.-]*\/[\w.-]+$/;

/**
 * Whether a Trackio Space is up yet.
 *
 * Server-side because the token stays here, and because a cross-origin fetch of
 * the Space cannot tell "still building" from "blocked by CORS". Polled by the
 * dashboard chip, so it never enters the model's context.
 */
export const GET: RequestHandler = async ({ url, locals }) => {
	const spaceId = url.searchParams.get("space") ?? "";
	if (!SPACE_ID.test(spaceId)) error(400, "Bad Space id");

	// The user's own token, whatever USE_USER_TOKEN says about inference: it only
	// goes to the Hub, and without it a private dashboard reads as missing and an
	// anonymous caller is the first to be rate-limited.
	const token = locals.token;
	return superjsonResponse({ status: await fetchTrackioSpaceStatus(spaceId, token) });
};
