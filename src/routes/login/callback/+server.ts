import { redirect, error } from "@sveltejs/kit";
import {
	authCondition,
	getOIDCUserData,
	getRedirectURI,
	refreshSessionCookie,
	validateCsrfToken,
} from "$lib/server/auth";
import { z } from "zod";
import { collections } from "$lib/server/database";
import { ObjectId } from "mongodb";
import { base } from "$app/paths";
import { defaultModel } from "$lib/server/models";

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

	if (!validateCsrfToken(csrfToken, locals.sessionId)) {
		throw error(403, "Invalid or expired CSRF token");
	}

	const { userData } = await getOIDCUserData({ redirectURI: getRedirectURI(url) }, code);

	const {
		preferred_username: username,
		name,
		picture: avatarUrl,
		sub: hfUserId,
	} = z
		.object({
			preferred_username: z.string(),
			name: z.string(),
			picture: z.string(),
			sub: z.string(),
		})
		.parse(userData);

	const existingUser = await collections.users.findOne({ hfUserId });

	if (existingUser) {
		// update existing user if any
		await collections.users.updateOne(
			{ _id: existingUser._id },
			{ $set: { username, name, avatarUrl } }
		);
		// refresh session cookie
		refreshSessionCookie(cookies, existingUser.sessionId);
	} else {
		// user doesn't exist yet, create a new one
		const { insertedId } = await collections.users.insertOne({
			_id: new ObjectId(),
			createdAt: new Date(),
			updatedAt: new Date(),
			username,
			name,
			avatarUrl,
			hfUserId,
			sessionId: locals.sessionId,
		});

		// update pre-existing settings
		const { matchedCount } = await collections.settings.updateOne(
			{ sessionId: locals.sessionId },
			{ $set: { userId: insertedId }, $unset: { sessionId: "" } }
		);

		if (matchedCount) {
			// migrate pre-existing conversations if any
			await collections.conversations.updateMany(
				{ sessionId: locals.sessionId },
				{ $set: { userId: insertedId }, $unset: { sessionId: "" } }
			);
		} else {
			// update settings if existing or create new default ones
			await collections.settings.insertOne({
				userId: insertedId,
				ethicsModalAcceptedAt: new Date(),
				updatedAt: new Date(),
				shareConversationsWithModelAuthors: true,
				activeModel: defaultModel.id,
				createdAt: new Date(),
			});
		}
	}

	throw redirect(302, base || "/");
}
