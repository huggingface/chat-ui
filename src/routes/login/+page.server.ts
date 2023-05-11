import { redirect } from "@sveltejs/kit";
import { getOIDCAuthorizationUrl, getRedirectURI } from "$lib/server/auth";

export const actions = {
	default: async function ({ url, locals }) {
		const ssoAuthorizationUrl = await getOIDCAuthorizationUrl(
			{ redirectURI: getRedirectURI(url) },
			{ sessionId: locals.sessionId }
		);

		throw redirect(303, ssoAuthorizationUrl);
	},
};
