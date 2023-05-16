import { redirect, error } from "@sveltejs/kit";
import { getOIDCUserData, getRedirectURI, validateCsrfToken } from "$lib/server/auth";
import { z } from "zod";
import { base } from "$app/paths";
import { updateUser } from "./updateUser";

export async function GET({ url, locals, cookies }) {
	const { error: errorName } = z
		.object({
			error: z.string().optional(),
		})
		.parse(Object.fromEntries(url.searchParams.entries()));

	if (errorName) {
		// TODO: Display denied error on the UI
		throw redirect(302, base || "/");
	}

	const { code, state } = z
		.object({
			code: z.string(),
			state: z.string(),
		})
		.parse(Object.fromEntries(url.searchParams.entries()));

	const csrfToken = Buffer.from(state, "base64").toString("utf-8");

	const isValidToken = await validateCsrfToken(csrfToken, locals.sessionId);

	if (!isValidToken) {
		throw error(403, "Invalid or expired CSRF token");
	}

	const { userData } = await getOIDCUserData({ redirectURI: getRedirectURI(url) }, code);

	await updateUser({ userData, locals, cookies });

	throw redirect(302, base || "/");
}
