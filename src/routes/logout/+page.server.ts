import { dev } from "$app/environment";
import { base } from "$app/paths";
import { COOKIE_NAME } from "$env/static/private";
import { redirect } from "@sveltejs/kit";

export const actions = {
	default: async function ({ cookies }) {
		cookies.delete(COOKIE_NAME, {
			path: "/",
			// So that it works inside the space's iframe
			sameSite: dev ? "lax" : "none",
			secure: !dev,
			httpOnly: true,
		});
		throw redirect(303, `${base}/`);
	},
};
