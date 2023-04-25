import { dev } from "$app/environment";
import { COOKIE_NAME } from "$env/static/private";
import type { Handle } from "@sveltejs/kit";
import { addYears } from "date-fns";

export const handle: Handle = async ({ event, resolve }) => {
	const token = event.cookies.get(COOKIE_NAME);

	event.locals.sessionId = token || crypto.randomUUID();

	// Refresh cookie expiration date
	event.cookies.set(COOKIE_NAME, event.locals.sessionId, {
		path: "/",
		sameSite: "lax",
		secure: !dev,
		httpOnly: true,
		expires: addYears(new Date(), 1),
	});

	const response = await resolve(event);

	return response;
};
