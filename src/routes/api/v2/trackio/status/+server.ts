import { error, type RequestHandler } from "@sveltejs/kit";
import { superjsonResponse } from "$lib/server/api/utils/superjsonResponse";
import { config } from "$lib/server/config";
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

	const token = config.USE_USER_TOKEN === "true" ? locals.token : undefined;
	return superjsonResponse({ status: await fetchTrackioSpaceStatus(spaceId, token) });
};
