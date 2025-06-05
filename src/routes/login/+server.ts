import { getOIDCAuthorizationUrl } from "$lib/server/auth";
import { base } from "$app/paths";
import { config } from "$lib/server/config";

export async function GET({ request, url, locals }) {
	const referer = request.headers.get("referer");
	let redirectURI = `${(referer ? new URL(referer) : url).origin}${base}/login/callback`;

	// TODO: Handle errors if provider is not responding

	if (url.searchParams.has("callback")) {
		const callback = url.searchParams.get("callback") || redirectURI;
		if (config.ALTERNATIVE_REDIRECT_URLS.includes(callback)) {
			redirectURI = callback;
		}
	}

	const authorizationUrl = await getOIDCAuthorizationUrl(
		{ redirectURI },
		{ sessionId: locals.sessionId }
	);

	return new Response(null, {
		status: 302,
		headers: {
			Location: authorizationUrl,
		},
	});
}
