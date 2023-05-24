import { Issuer, BaseClient, type UserinfoResponse, TokenSet } from "openid-client";
import { addHours, addYears } from "date-fns";
import {
	COOKIE_NAME,
	OPENID_CLIENT_ID,
	OPENID_CLIENT_SECRET,
	OPENID_PROVIDER_URL,
	OPENID_SCOPES,
} from "$env/static/private";
import { sha256 } from "$lib/utils/sha256";
import { z } from "zod";
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

export const authCondition = (locals: App.Locals) => {
	return locals.user
		? { userId: locals.user._id }
		: { sessionId: locals.sessionId, userId: { $exists: false } };
};

/**
 * Generates a CSRF token using the user sessionId. Note that we don't need a secret because sessionId is enough.
 */
export async function generateCsrfToken(sessionId: string, redirectUrl: string): Promise<string> {
	const data = {
		expiration: addHours(new Date(), 1).getTime(),
		redirectUrl,
	};

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
	const csrfToken = await generateCsrfToken(params.sessionId, settings.redirectURI);
	const url = client.authorizationUrl({
		scope: OPENID_SCOPES,
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

export async function validateAndParseCsrfToken(
	token: string,
	sessionId: string
): Promise<{
	/** This is the redirect url that was passed to the OIDC provider */
	redirectUrl: string;
} | null> {
	try {
		const { data, signature } = z
			.object({
				data: z.object({
					expiration: z.number().int(),
					redirectUrl: z.string().url(),
				}),
				signature: z.string().length(64),
			})
			.parse(JSON.parse(token));
		const reconstructSign = await sha256(JSON.stringify(data) + "##" + sessionId);

		if (data.expiration > Date.now() && signature === reconstructSign) {
			return { redirectUrl: data.redirectUrl };
		}
	} catch (e) {
		console.error(e);
	}
	return null;
}
