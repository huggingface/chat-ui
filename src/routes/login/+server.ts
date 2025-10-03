import { triggerOauthFlow } from "$lib/server/auth";

export async function GET({ request, url, locals }) {
	return await triggerOauthFlow({ request, url, locals });
}
