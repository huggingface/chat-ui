import { base } from "$app/paths";
import { redirect } from "@sveltejs/kit";
import { HF_CLIENT_ID } from "$env/static/private";

export const actions = {
	default: async function () {
		var redirectUri = base + "/login/callback";

		throw redirect(
			303,
			`https://github.com/login/oauth/authorize?client_id=${HF_CLIENT_ID}&redirect_uri=${redirectUri}`
		);
	},
};
