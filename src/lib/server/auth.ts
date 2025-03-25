import {
	Issuer,
	type BaseClient,
	type UserinfoResponse,
	type TokenSet,
	custom,
} from "openid-client";
import { addHours, addWeeks } from "date-fns";
import { env } from "$env/dynamic/private";
import { sha256 } from "$lib/utils/sha256";
import { z } from "zod";
import { dev } from "$app/environment";
import type { Cookies } from "@sveltejs/kit";
import { collections } from "$lib/server/database";
import JSON5 from "json5";
import { logger } from "$lib/server/logger";
import { ObjectId } from "mongodb";
import type { Cookie } from "elysia";

export interface OIDCSettings {
	redirectURI: string;
}

export interface OIDCUserInfo {
	token: TokenSet;
	userData: UserinfoResponse;
}

const stringWithDefault = (value: string) =>
	z
		.string()
		.default(value)
		.transform((el) => (el ? el : value));

export const OIDConfig = z
	.object({
		CLIENT_ID: stringWithDefault(env.OPENID_CLIENT_ID),
		CLIENT_SECRET: stringWithDefault(env.OPENID_CLIENT_SECRET),
		PROVIDER_URL: stringWithDefault(env.OPENID_PROVIDER_URL),
		SCOPES: stringWithDefault(env.OPENID_SCOPES),
		NAME_CLAIM: stringWithDefault(env.OPENID_NAME_CLAIM).refine(
			(el) => !["preferred_username", "email", "picture", "sub"].includes(el),
			{ message: "nameClaim cannot be one of the restricted keys." }
		),
		TOLERANCE: stringWithDefault(env.OPENID_TOLERANCE),
		RESOURCE: stringWithDefault(env.OPENID_RESOURCE),
		ID_TOKEN_SIGNED_RESPONSE_ALG: z.string().optional(),
	})
	.parse(JSON5.parse(env.OPENID_CONFIG || "{}"));

export const requiresUser = !!OIDConfig.CLIENT_ID && !!OIDConfig.CLIENT_SECRET;

const sameSite = z
	.enum(["lax", "none", "strict"])
	.default(dev || env.ALLOW_INSECURE_COOKIES === "true" ? "lax" : "none")
	.parse(env.COOKIE_SAMESITE === "" ? undefined : env.COOKIE_SAMESITE);

const secure = z
	.boolean()
	.default(!(dev || env.ALLOW_INSECURE_COOKIES === "true"))
	.parse(env.COOKIE_SECURE === "" ? undefined : env.COOKIE_SECURE === "true");

export function refreshSessionCookie(cookies: Cookies, sessionId: string) {
	cookies.set(env.COOKIE_NAME, sessionId, {
		path: "/",
		// So that it works inside the space's iframe
		sameSite,
		secure,
		httpOnly: true,
		expires: addWeeks(new Date(), 2),
	});
}

export async function findUser(sessionId: string) {
	const session = await collections.sessions.findOne({ sessionId });

	if (!session) {
		return null;
	}

	return await collections.users.findOne({ _id: session.userId });
}
export const authCondition = (locals: App.Locals) => {
	if (!locals.user && !locals.sessionId) {
		throw new Error("User or sessionId is required");
	}

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
	const issuer = await Issuer.discover(OIDConfig.PROVIDER_URL);

	const client_config: ConstructorParameters<typeof issuer.Client>[0] = {
		client_id: OIDConfig.CLIENT_ID,
		client_secret: OIDConfig.CLIENT_SECRET,
		redirect_uris: [settings.redirectURI],
		response_types: ["code"],
		[custom.clock_tolerance]: OIDConfig.TOLERANCE || undefined,
		id_token_signed_response_alg: OIDConfig.ID_TOKEN_SIGNED_RESPONSE_ALG || undefined,
	};

	const alg_supported = issuer.metadata["id_token_signing_alg_values_supported"];

	if (Array.isArray(alg_supported)) {
		client_config.id_token_signed_response_alg ??= alg_supported[0];
	}

	return new issuer.Client(client_config);
}

export async function getOIDCAuthorizationUrl(
	settings: OIDCSettings,
	params: { sessionId: string }
): Promise<string> {
	const client = await getOIDCClient(settings);
	const csrfToken = await generateCsrfToken(params.sessionId, settings.redirectURI);

	return client.authorizationUrl({
		scope: OIDConfig.SCOPES,
		state: csrfToken,
		resource: OIDConfig.RESOURCE || undefined,
	});
}

export async function getOIDCUserData(
	settings: OIDCSettings,
	code: string,
	iss?: string
): Promise<OIDCUserInfo> {
	const client = await getOIDCClient(settings);
	const token = await client.callback(settings.redirectURI, { code, iss });
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
		logger.error(e);
	}
	return null;
}

type CookieRecord =
	| { type: "elysia"; value: Record<string, Cookie<string | undefined>> }
	| { type: "svelte"; value: Cookies };
type HeaderRecord =
	| { type: "elysia"; value: Record<string, string | undefined> }
	| { type: "svelte"; value: Headers };

export async function authenticateRequest(
	headers: HeaderRecord,
	cookie: CookieRecord,
	isApi?: boolean
): Promise<App.Locals & { secretSessionId: string }> {
	// once the entire API has been moved to elysia
	// we can move this function to authPlugin.ts
	// and get rid of the isApi && type: "svelte" options
	const token =
		cookie.type === "elysia"
			? cookie.value[env.COOKIE_NAME].value
			: cookie.value.get(env.COOKIE_NAME);

	let email = null;
	if (env.TRUSTED_EMAIL_HEADER) {
		if (headers.type === "elysia") {
			email = headers.value[env.TRUSTED_EMAIL_HEADER];
		} else {
			email = headers.value.get(env.TRUSTED_EMAIL_HEADER);
		}
	}

	let secretSessionId: string | null = null;
	let sessionId: string | null = null;

	if (email) {
		secretSessionId = sessionId = await sha256(email);
		return {
			user: {
				_id: new ObjectId(sessionId.slice(0, 24)),
				name: email,
				email,
				createdAt: new Date(),
				updatedAt: new Date(),
				hfUserId: email,
				avatarUrl: "",
				logoutDisabled: true,
			},
			sessionId,
			secretSessionId,
		};
	}

	if (token) {
		secretSessionId = token;
		sessionId = await sha256(token);
		const user = await findUser(sessionId);
		return { user: user ?? undefined, sessionId, secretSessionId };
	}

	if (isApi) {
		const authorization =
			headers.type === "elysia"
				? headers.value["Authorization"]
				: headers.value.get("Authorization");
		if (authorization?.startsWith("Bearer ")) {
			const token = authorization.slice(7);
			const hash = await sha256(token);
			sessionId = secretSessionId = hash;

			const cacheHit = await collections.tokenCaches.findOne({ tokenHash: hash });
			if (cacheHit) {
				const user = await collections.users.findOne({ hfUserId: cacheHit.userId });
				if (!user) {
					throw new Error("User not found");
				}
				return { user, sessionId, secretSessionId };
			}

			const response = await fetch("https://huggingface.co/api/whoami-v2", {
				headers: { Authorization: `Bearer ${token}` },
			});

			if (!response.ok) {
				throw new Error("Unauthorized");
			}

			const data = await response.json();
			const user = await collections.users.findOne({ hfUserId: data.id });
			if (!user) {
				throw new Error("User not found");
			}

			await collections.tokenCaches.insertOne({
				tokenHash: hash,
				userId: data.id,
				createdAt: new Date(),
				updatedAt: new Date(),
			});

			return {
				user,
				sessionId,
				secretSessionId,
			};
		}
	}

	// Generate new session if none exists
	secretSessionId = crypto.randomUUID();
	sessionId = await sha256(secretSessionId);

	if (await collections.sessions.findOne({ sessionId })) {
		throw new Error("Session ID collision");
	}

	return { user: undefined, sessionId, secretSessionId };
}
