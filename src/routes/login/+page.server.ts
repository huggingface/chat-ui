import { redirect } from "@sveltejs/kit";
import { getOIDCAuthorizationUrl } from "$lib/server/auth";
import { base } from "$app/paths";

export const actions = {
	default: async function ({ url, locals, request }) {
		// TODO: Handle errors if provider is not responding
		const referer = request.headers.get("referer");
		const authorizationUrl = await getOIDCAuthorizationUrl(
			{ redirectURI: `${(referer ? new URL(referer) : url).origin}${base}/login/callback` },
			{ sessionId: locals.sessionId }
		);

		throw redirect(303, authorizationUrl);
	},
};
