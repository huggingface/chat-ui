import { Issuer, BaseClient, type UserinfoResponse, TokenSet } from "openid-client";
import { addDays } from "date-fns";
import { HF_CLIENT_ID, HF_CLIENT_SECRET, HF_HUB_URL } from "$env/static/private";
import { instantSha256 } from "$lib/utils/sha256";
import { z } from "zod";
import { PUBLIC_ORIGIN } from "$env/static/public";
import { base } from "$app/paths";

export interface OIDCSettings {
	redirectURI: string;
}

export interface SSOUserInformation {
	token: TokenSet;
	userData: UserinfoResponse;
}

export const requiresUser = !!HF_CLIENT_ID && !!HF_CLIENT_SECRET;

export const getRedirectURI = (url: URL) => `${PUBLIC_ORIGIN || url.origin}${base}/login/callback`;

export const OIDC_SCOPES = "openid profile";

export const authCondition = (locals: App.Locals) => {
	return locals.userId
		? { userId: locals.userId }
		: { sessionId: locals.sessionId, userId: { $exists: false } };
};

// Mostly taken from https://github.com/huggingface/moon-landing/tree/main/server/lib/Auth.ts
export function generateCsrfToken(sessionId: string): string {
	const data = { expiration: addDays(new Date(), 1).getTime() };

	return Buffer.from(
		JSON.stringify({ data, signature: instantSha256(JSON.stringify(data) + "##" + sessionId) })
	).toString("base64");
}

async function getOIDCClient(settings: OIDCSettings): Promise<BaseClient> {
	const issuer = await Issuer.discover(HF_HUB_URL);
	return new issuer.Client({
		client_id: HF_CLIENT_ID,
		client_secret: HF_CLIENT_SECRET,
		redirect_uris: [settings.redirectURI],
		response_types: ["code"],
	});
}

export async function getOIDCAuthorizationUrl(
	settings: OIDCSettings,
	params: { sessionId: string }
): Promise<string> {
	const client = await getOIDCClient(settings);
	const csrfToken = generateCsrfToken(params.sessionId);
	const url = client.authorizationUrl({
		scope: OIDC_SCOPES,
		state: csrfToken,
	});

	return url;
}

export async function getOIDCUserData(
	settings: OIDCSettings,
	code: string
): Promise<SSOUserInformation> {
	const client = await getOIDCClient(settings);
	const token = await client.callback(settings.redirectURI, { code });
	const userData = await client.userinfo(token);

	return { token, userData };
}

export function validateCsrfToken(token: string, sessionId: string): boolean {
	try {
		const { data, signature } = z
			.object({
				data: z.object({
					expiration: z.number().int(),
				}),
				signature: z.string().length(64),
			})
			.parse(JSON.parse(token));

		return (
			data.expiration > Date.now() &&
			signature === instantSha256(JSON.stringify(data) + "##" + sessionId)
		);
	} catch (e) {
		console.error(e);
		return false;
	}
}
