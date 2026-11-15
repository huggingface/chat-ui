import { config } from "$lib/server/config";

export function getApiToken(locals: App.Locals | undefined) {
	if (config.USE_USER_TOKEN === "true") {
		if (!locals?.token) {
			throw new Error("User token not found");
		}
		return locals.token;
	}
	return config.OPENAI_API_KEY || config.HF_TOKEN;
}

/**
 * `locals.token` is whatever the deployment's OIDC provider issued, so it only
 * goes to huggingface.co when that provider is the Hub (or the operator opted
 * into user tokens).
 */
export function getUserHubToken(locals: App.Locals | undefined): string | undefined {
	if (!locals?.token) return undefined;
	if (config.USE_USER_TOKEN === "true") return locals.token;
	return hubIsOidcProvider() ? locals.token : undefined;
}

function hubIsOidcProvider(): boolean {
	try {
		return new URL(config.OPENID_PROVIDER_URL).hostname === "huggingface.co";
	} catch {
		return false;
	}
}

/**
 * writing needs contribute-repos, which lets the app create repos and update only the ones it created
 * a Hub sign-in carries only the scopes the app asks for, user tokens or not
 */
export function getUserHubWriteToken(locals: App.Locals | undefined): string | undefined {
	const token = getUserHubToken(locals);
	if (!token || !hubIsOidcProvider()) return token;
	return (config.OPENID_SCOPES ?? "").split(/\s+/).includes("contribute-repos") ? token : undefined;
}
