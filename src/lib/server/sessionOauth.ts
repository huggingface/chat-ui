import { config } from "$lib/server/config";
import { createSecretBox } from "$lib/server/secretBox";
import type { Session } from "$lib/types/Session";

type SessionOauth = NonNullable<Session["oauth"]>;

const box = createSecretBox(
	() => config.SESSION_OAUTH_ENCRYPTION_KEY,
	"[auth] SESSION_OAUTH_ENCRYPTION_KEY is not set; users' sign-in access and refresh tokens are stored unencrypted in the sessions collection."
);

export function hasSessionOauthKey(): boolean {
	return box.hasKey();
}

export function encryptSessionOauth(oauth: SessionOauth): SessionOauth {
	return {
		token: { ...oauth.token, value: box.encrypt(oauth.token.value) },
		...(oauth.refreshToken ? { refreshToken: box.encrypt(oauth.refreshToken) } : {}),
	};
}

/** undefined when a token cannot be decrypted, the session must sign in again */
export function decryptSessionOauth(oauth: SessionOauth): SessionOauth | undefined {
	const value = box.decrypt(oauth.token.value);
	const refreshToken = oauth.refreshToken ? box.decrypt(oauth.refreshToken) : undefined;
	if (!value || refreshToken === "") return undefined;
	return {
		token: { ...oauth.token, value },
		...(refreshToken ? { refreshToken } : {}),
	};
}
