import { Issuer, BaseClient, type UserinfoResponse, TokenSet } from "openid-client";
import { addDays } from "date-fns";
import { HF_CLIENT_ID, HF_CLIENT_SECRET, AUTH_SECRET } from "$env/static/private";
import { instantSha256 } from "$lib/utils/sha256";
import { z } from "zod";

export interface OIDCSettings {
	redirectURI: string;
}

export interface SSOUserInformation {
	token: TokenSet;
	userData: UserinfoResponse;
}

export const requiresUser = !!HF_CLIENT_ID && !!HF_CLIENT_SECRET;

export const OIDC_SCOPES = "openid profile";

export const authCondition = (locals: App.Locals) => {
	return locals.userId
		? { userId: locals.userId }
		: { sessionId: locals.sessionId, userId: { $exists: false } };
};

// Mostly taken from https://github.com/huggingface/moon-landing/tree/main/server/lib/Auth.ts
export function generateCsrfToken(sessionId: string): string {
	const data = { expiration: addDays(new Date(), 1).getTime(), sessionId };
	const token = JSON.stringify(data);

	return Buffer.from(
		JSON.stringify({ data, signature: instantSha256(token + "##" + AUTH_SECRET) })
	).toString("base64");
}

async function getOIDCClient(settings: OIDCSettings): Promise<BaseClient> {
	const issuer = await Issuer.discover("http://localhost:5564/.well-known/openid-configuration");
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
		state: Buffer.from(`${settings.redirectURI}|${csrfToken}`, "utf8").toString("base64"),
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
					sessionId: z.string(),
				}),
				// TODO: check if we need Joi.hex() missing from original code
				signature: z.string().length(64),
			})
			.parse(JSON.parse(Buffer.from(token, "base64").toString()));

		return (
			data.expiration > Date.now() &&
			sessionId === data.sessionId &&
			signature === instantSha256(JSON.stringify(data) + "##" + AUTH_SECRET)
		);
	} catch {
		// In case of Zod error mostly
		return false;
	}
}
