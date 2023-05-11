import { redirect } from "@sveltejs/kit";
import { getOIDCAuthorizationUrl } from "$lib/server/auth";
import { base } from "$app/paths";
import { PUBLIC_ORIGIN } from "$env/static/public";

export const actions = {
	default: async function ({ url, locals }) {
		const redirectURI = `${PUBLIC_ORIGIN || url.origin}${base}/login/callback`;
		const ssoAuthorizationUrl = await getOIDCAuthorizationUrl(
			{ redirectURI },
			{ sessionId: locals.sessionId }
		);

		console.log(ssoAuthorizationUrl);

		throw redirect(303, ssoAuthorizationUrl);
	},
};
