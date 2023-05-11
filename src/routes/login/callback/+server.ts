import { redirect, error } from "@sveltejs/kit";
import { getOIDCUserData, getRedirectURI, validateCsrfToken } from "$lib/server/auth";
import { z } from "zod";
import { collections } from "$lib/server/database";
import { ObjectId } from "mongodb";

export async function GET({ url, locals }) {
	// http://localhost:5173/login/callback?code=DvTPMLrAaNNamqli&state=aHR0cDovL2xvY2FsaG9zdDo1MTczL2xvZ2luL2NhbGxiYWNrfGV5SmtZWFJoSWpwN0ltVjRjR2x5WVhScGIyNGlPakUyT0RNNE9EUTVPRFk1T1Rnc0luTmxjM05wYjI1SlpDSTZJbVY1U21oaVIyTnBUMmxLYTJGWVNXbE1RMHBzWW0xTmFVOXBTa0pOYWxVeVVqQk9Ua2x1TUM0dVkxUTVRVXB6WjBVMk1uTkhkV1pQT1M0Mk5WbGZkR2x6UWtkYVgzWlhiRFpaVTB0UmMxbFhjV2hqWHpKRFlqUkVaRzFPWnpOZmJGTllWelprVFRFd1ZsOXJiMmxmY0V4QlZISldMVFV6WVdSbVFucG9RamxwVFdGQ2VUUkJYeTFDUmtaME5FNWtRbkpXTm1sQ1UxbGpkbTFrWmxGTFgyeGtTazFtWlZCT2QxVTFjMWxzVFROeVNWOWtUMnhsYTJGZldIZENWR3RyVmtjeGEwWlpOMW8wYUZKUWJtbE5OR2xEUVUxNE5saHVVVGt3ZDFWRmJGTmxSWFZ2VkdWUVVVUjFOa0ZwZEZwdGFrTTBhR3BKUkdOaVh6TldMV0p1V1VkTlluZ3hXSG90ZUUxaldtbEVXRGszWkcxT1kwUlBRWFpEVmtsM1QxVTBhRlY1U25Sa1IweGlkRzFOY2tGTVYycHZhbmd3YWxZMVJHSmFNMHN5UjIxU2QyTkhNbXRNY2tkSFdIRm5hRzFvVURndVFURkJlbWxVTjBOeU15MDRabE56V2t4Mk9GUmpkeUo5TENKemFXZHVZWFIxY21VaU9pSmlZMkkyTldRMk5HRXhZMlZrTnpFeFpqTXpaRFV5WXpnNU1XRmlaREF5WVRjeU5XSTJZV1ZsTmpBNE16QXpabVk0T1RKbFptWmpObVpsWVdNMk56ZGhJbjA9
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

	// find sessionId in db if existing and migrate it to a user
	const anonymousUser = await collections.users.findOne({ sessionId: locals.sessionId });
	let userId;

	if (anonymousUser) {
		await collections.users.updateOne(
			{ sessionId: locals.sessionId },
			{ $set: { hfUserId, username, name, avatarUrl } }
		);

		// migrate pre-existing conversations if any
		await collections.conversations.updateMany(
			{ sessionId: locals.sessionId },
			{ $set: { userId }, $unset: { sessionId: "" } }
		);
	} else {
		const existingUser = await collections.users.findOne({ hfUserId });

		// update existing user if any
		if (existingUser) {
			await collections.users.updateOne(
				{ hfUserId },
				{ $set: { username, name, avatarUrl, sessionId: locals.sessionId } }
			);
			userId = existingUser._id;
		} else {
			// user doesn't exist yet, create a new one
			const res = await collections.users.insertOne({
				_id: new ObjectId(),
				createdAt: new Date(),
				updatedAt: new Date(),
				username,
				name,
				avatarUrl,
				hfUserId,
				sessionId: locals.sessionId,
			});
			userId = res.insertedId;
		}
	}

	// update pre-existing settings
	await collections.settings.updateOne(
		{ sessionId: locals.sessionId },
		{ $set: { userId }, $unset: { sessionId: "" } }
	);

	throw redirect(303, "/");
}
