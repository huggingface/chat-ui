import { error, redirect } from "@sveltejs/kit";
import {
	clearLoginRetryCookie,
	getOIDCUserData,
	hasLoginRetryCookie,
	sanitizeReturnPath,
	setLoginRetryCookie,
	validateAndParseCsrfToken,
} from "$lib/server/auth";
import { z } from "zod";
import { base } from "$app/paths";
import { config } from "$lib/server/config";
import JSON5 from "json5";
import { updateUser } from "./updateUser.js";

const sanitizeJSONEnv = (val: string, fallback: string) => {
	const raw = (val ?? "").trim();
	const unquoted = raw.startsWith("`") && raw.endsWith("`") ? raw.slice(1, -1) : raw;
	return unquoted || fallback;
};

const allowedUserEmails = z
	.array(z.string().email())
	.optional()
	.default([])
	.parse(JSON5.parse(sanitizeJSONEnv(config.ALLOWED_USER_EMAILS, "[]")));

const allowedUserDomains = z
	.array(z.string().regex(/\.\w+$/)) // Contains at least a dot
	.optional()
	.default([])
	.parse(JSON5.parse(sanitizeJSONEnv(config.ALLOWED_USER_DOMAINS, "[]")));

export async function GET({ url, locals, cookies, request, getClientAddress }) {
	const { error: errorName, error_description: errorDescription } = z
		.object({
			error: z.string().optional(),
			error_description: z.string().optional(),
		})
		.parse(Object.fromEntries(url.searchParams.entries()));

	if (errorName) {
		throw error(400, errorName + (errorDescription ? ": " + errorDescription : ""));
	}

	const { code, state, iss } = z
		.object({
			code: z.string(),
			state: z.string(),
			iss: z.string().optional(),
		})
		.parse(Object.fromEntries(url.searchParams.entries()));

	const csrfToken = Buffer.from(state, "base64").toString("utf-8");

	const validatedToken = await validateAndParseCsrfToken(csrfToken, locals.sessionId);
	const codeVerifier = cookies.get("hfChat-codeVerifier");

	if (!validatedToken || !codeVerifier) {
		// The `state` token and PKCE code verifier are bound to the browser that started the
		// login flow, so either check can fail on its own; when the callback lands in a
		// different browser (e.g. "Open in Safari" from an in-app browser) both do. Restart
		// the flow once in this browser instead of dead-ending on a 403.
		if (!hasLoginRetryCookie(cookies)) {
			setLoginRetryCookie(cookies);

			// Best-effort recovery of the return path and redirect URI from the (unverified)
			// state payload; the path is re-sanitized and the redirect URI is checked against
			// ALTERNATIVE_REDIRECT_URLS both here and again in triggerOauthFlow before use.
			const retryParams = new URLSearchParams();
			try {
				const data = JSON.parse(csrfToken)?.data;
				const next = sanitizeReturnPath(data?.next);
				if (next) {
					retryParams.set("next", next);
				}
				if (
					typeof data?.redirectUrl === "string" &&
					config.ALTERNATIVE_REDIRECT_URLS.includes(data.redirectUrl)
				) {
					retryParams.set("callback", data.redirectUrl);
				}
			} catch {
				// Malformed state: retry without a return path or alternate redirect URI.
			}

			const retryQuery = retryParams.toString();
			return redirect(302, `${base}/login${retryQuery ? `?${retryQuery}` : ""}`);
		}

		throw error(
			403,
			validatedToken ? "Code verifier cookie not found" : "Invalid or expired CSRF token"
		);
	}

	const { userData, token } = await getOIDCUserData(
		{ redirectURI: validatedToken.redirectUrl },
		code,
		codeVerifier,
		iss,
		url
	);

	// Filter by allowed user emails or domains
	if (allowedUserEmails.length > 0 || allowedUserDomains.length > 0) {
		if (!userData.email) {
			throw error(403, "User not allowed: email not returned");
		}
		const emailVerified = userData.email_verified ?? true;
		if (!emailVerified) {
			throw error(403, "User not allowed: email not verified");
		}

		const emailDomain = userData.email.split("@")[1];
		const isEmailAllowed = allowedUserEmails.includes(userData.email);
		const isDomainAllowed = allowedUserDomains.includes(emailDomain);

		if (!isEmailAllowed && !isDomainAllowed) {
			throw error(403, "User not allowed");
		}
	}

	await updateUser({
		userData,
		token,
		locals,
		cookies,
		userAgent: request.headers.get("user-agent") ?? undefined,
		ip: getClientAddress(),
	});

	clearLoginRetryCookie(cookies);

	// Prefer returning the user to their original in-app path when provided.
	// `validatedToken.next` is sanitized server-side to avoid protocol-relative redirects.
	const next = validatedToken.next;
	if (next) {
		return redirect(302, next);
	}
	return redirect(302, `${base}/`);
}
