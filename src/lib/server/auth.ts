import { Issuer, BaseClient, type UserinfoResponse, TokenSet } from "openid-client";
import { addDays, addYears } from "date-fns";
import {
	COOKIE_NAME,
	OPENID_CLIENT_ID,
	OPENID_CLIENT_SECRET,
	OPENID_PROVIDER_URL,
} from "$env/static/private";
import { PUBLIC_ORIGIN } from "$env/static/public";
import { sha256 } from "$lib/utils/sha256";
import { z } from "zod";
import { base } from "$app/paths";
import { dev } from "$app/environment";
import type { Cookies } from "@sveltejs/kit";

export interface OIDCSettings {
	redirectURI: string;
}

export interface OIDCUserInfo {
	token: TokenSet;
	userData: UserinfoResponse;
}

export const requiresUser = !!OPENID_CLIENT_ID && !!OPENID_CLIENT_SECRET;

export function refreshSessionCookie(cookies: Cookies, sessionId: string) {
	cookies.set(COOKIE_NAME, sessionId, {
		path: "/",
		// So that it works inside the space's iframe
		sameSite: dev ? "lax" : "none",
		secure: !dev,
		httpOnly: true,
		expires: addYears(new Date(), 1),
	});
}

export const getRedirectURI = (url: URL) => `${PUBLIC_ORIGIN || url.origin}${base}/login/callback`;

export const OIDC_SCOPES = "openid profile";

export const authCondition = (locals: App.Locals) => {
	return locals.user
		? { userId: locals.user._id }
		: { sessionId: locals.sessionId, userId: { $exists: false } };
};

/**
 * Generates a CSRF token using the user sessionId. Note that we don't need a secret because sessionId is enough.
 */
export async function generateCsrfToken(sessionId: string): Promise<string> {
	const data = { expiration: addDays(new Date(), 1).getTime() };

	return Buffer.from(
		JSON.stringify({
			data,
			signature: await sha256(JSON.stringify(data) + "##" + sessionId),
		})
	).toString("base64");
}

async function getOIDCClient(settings: OIDCSettings): Promise<BaseClient> {
	const issuer = await Issuer.discover(OPENID_PROVIDER_URL);
	return new issuer.Client({
		client_id: OPENID_CLIENT_ID,
		client_secret: OPENID_CLIENT_SECRET,
		redirect_uris: [settings.redirectURI],
		response_types: ["code"],
	});
}

export async function getOIDCAuthorizationUrl(
	settings: OIDCSettings,
	params: { sessionId: string }
): Promise<string> {
	const client = await getOIDCClient(settings);
	const csrfToken = await generateCsrfToken(params.sessionId);
	const url = client.authorizationUrl({
		scope: OIDC_SCOPES,
		state: csrfToken,
	});

	return url;
}

export async function getOIDCUserData(settings: OIDCSettings, code: string): Promise<OIDCUserInfo> {
	const client = await getOIDCClient(settings);
	const token = await client.callback(settings.redirectURI, { code });
	const userData = await client.userinfo(token);

	return { token, userData };
}

export async function validateCsrfToken(token: string, sessionId: string) {
	try {
		const { data, signature } = z
			.object({
				data: z.object({
					expiration: z.number().int(),
				}),
				signature: z.string().length(64),
			})
			.parse(JSON.parse(token));
		const reconstructSign = await sha256(JSON.stringify(data) + "##" + sessionId);

		return data.expiration > Date.now() && signature === reconstructSign;
	} catch (e) {
		console.error(e);
		return false;
	}
}
