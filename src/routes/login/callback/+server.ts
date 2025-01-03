import { redirect, error, type RequestEvent, type RequestHandler } from "@sveltejs/kit";
import { getOIDCUserData, ProviderCookieNames, validateAndParseCsrfToken } from "$lib/server/auth";
import { z } from "zod";
import { base } from "$app/paths";
import { updateUser } from "./updateUser";
import { env } from "$env/dynamic/private";
import JSON5 from "json5";

const allowedUserEmails = z
	.array(z.string().email())
	.optional()
	.default([])
	.parse(JSON5.parse(env.ALLOWED_USER_EMAILS));

async function handleLogin(requestEvent: RequestEvent) {
	const { url, locals, cookies, request, getClientAddress } = requestEvent;

	const { error: errorName, error_description: errorDescription } = z
		.object({
			error: z.string().optional(),
			error_description: z.string().optional(),
		})
		.parse(Object.fromEntries(url.searchParams.entries()));

	if (errorName) {
		error(400, errorName + (errorDescription ? ": " + errorDescription : ""));
	}

	let entries: IterableIterator<[string, string | FormDataEntryValue]>;
	if (request.method === "POST") {
		const formData = await request.formData();
		entries = formData.entries();
	} else {
		entries = url.searchParams.entries();
	}

	const {
		code,
		state,
		iss,
		id_token: idToken,
	} = z
		.object({
			code: z.string(),
			state: z.string(),
			iss: z.string().optional(),
			id_token: z.string().optional(),
		})
		.parse(Object.fromEntries(entries));

	const { csrfToken: csrfTokenBase64, sessionId: loginSessionId } = JSON.parse(
		Buffer.from(state, "base64").toString("utf-8")
	);
	const csrfToken = Buffer.from(csrfTokenBase64, "base64").toString("utf-8");
	const validatedToken = await validateAndParseCsrfToken(csrfToken, loginSessionId);

	if (!validatedToken) {
		error(403, "Invalid or expired CSRF token");
	}

	const { userData } = await getOIDCUserData(
		{
			redirectURI: validatedToken.redirectUrl,
			nonce: idToken ? loginSessionId : undefined,
		},
		code,
		iss
	);

	// Filter by allowed user emails
	if (allowedUserEmails.length > 0) {
		if (!userData.email) {
			error(403, "User not allowed: email not returned");
		}
		const emailVerified = userData.email_verified ?? true;
		if (!emailVerified) {
			error(403, "User not allowed: email not verified");
		}
		if (!allowedUserEmails.includes(userData.email)) {
			error(403, "User not allowed");
		}
	}

	if (idToken) {
		cookies.set(
			ProviderCookieNames.PROVIDER_PARAMS,
			JSON.stringify({ idToken, userTid: userData.tid, userOid: userData.oid }),
			{
				httpOnly: true,
				secure: true,
				sameSite: "none",
				path: env.APP_BASE || "/",
			}
		);
	}

	await updateUser({
		userData,
		locals,
		cookies,
		userAgent: request.headers.get("user-agent") ?? undefined,
		ip: getClientAddress(),
	});

	redirect(302, `${base}/`);
}

export const GET: RequestHandler = async (requestEvent) => {
	await handleLogin(requestEvent);
	throw redirect(302, `${base}/`);
};

export const POST: RequestHandler = async (requestEvent) => {
	await handleLogin(requestEvent);
	throw redirect(302, `${base}/`);
};
