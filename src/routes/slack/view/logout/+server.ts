import { cookieOptions, sessionCookie, flowCookie } from "$lib/server/slack/viewer/auth";
import { error } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
export const POST: RequestHandler = async ({ cookies, request, url }) => {
	if (request.headers.get("origin") !== url.origin) error(403, "Invalid origin.");
	cookies.delete(sessionCookie, cookieOptions);
	cookies.delete(flowCookie, cookieOptions);
	return new Response(null, { status: 204 });
};
