import { redirect } from "@sveltejs/kit";
import { getOIDCAuthorizationUrl } from "$lib/server/auth";
import { PUBLIC_ORIGIN } from "$env/static/public";
import { base } from "$app/paths";

export const actions = {
	default: async function ({ url, locals }) {
		const ssoAuthorizationUrl = await getOIDCAuthorizationUrl(
			{ redirectURI: `${PUBLIC_ORIGIN || url.origin}${base}/login/callback` },
			{ sessionId: locals.sessionId }
		);

		throw redirect(303, ssoAuthorizationUrl);
	},
};
