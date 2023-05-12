import { base } from "$app/paths";
import { COOKIE_NAME } from "$env/static/private";
import { redirect } from "@sveltejs/kit";

export const actions = {
	default: async function ({ cookies }) {
		cookies.delete(COOKIE_NAME);
		throw redirect(303, base || "/");
	},
};
