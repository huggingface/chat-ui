import { dev } from "$app/environment";
import { COOKIE_NAME } from "$env/static/private";
import type { Handle } from "@sveltejs/kit";
import { PUBLIC_GOOGLE_ANALYTICS_ID } from "$env/static/public";
import { addYears } from "date-fns";

export const handle: Handle = async ({ event, resolve }) => {
	const token = event.cookies.get(COOKIE_NAME);

	event.locals.sessionId = token || crypto.randomUUID();

	// Refresh cookie expiration date
	event.cookies.set(COOKIE_NAME, event.locals.sessionId, {
		path: "/",
		// So that it works inside the space's iframe
		sameSite: "none",
		secure: !dev,
		httpOnly: true,
		expires: addYears(new Date(), 1),
	});

	let replaced = false;

	const response = await resolve(event, {
		transformPageChunk: (chunk) => {
			// For some reason, Sveltekit doesn't let us load env variables from .env in the app.html template
			if (replaced || !chunk.html.includes("%gaId%")) {
				return chunk.html;
			}
			replaced = true;

			return chunk.html.replace("%gaId%", PUBLIC_GOOGLE_ANALYTICS_ID);
		},
	});

	return response;
};
