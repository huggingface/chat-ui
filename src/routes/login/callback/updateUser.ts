import { authCondition, refreshSessionCookie } from "$lib/server/auth";
import { collections } from "$lib/server/database";
import { ObjectId } from "mongodb";
import { DEFAULT_SETTINGS } from "$lib/types/Settings";
import { z } from "zod";
import type { UserinfoResponse } from "openid-client";
import type { Cookies } from "@sveltejs/kit";

export async function updateUser(params: {
	userData: UserinfoResponse;
	locals: App.Locals;
	cookies: Cookies;
}) {
	console.log("updateUser");
	const { userData, locals, cookies } = params;
	userData["preferred_username"] =
		userData["preferred_username"] || userData["email"]?.split("@")[0];
	const {
		preferred_username: username,
		name,
		picture: avatarUrl,
		sub: providerUserId,
	} = z
		.object({
			preferred_username: z.string(),
			name: z.string(),
			picture: z.string(),
			sub: z.string(),
		})
		.parse(userData);

	const existingUser = await collections.users.findOne({ providerUserId });
	let userId = existingUser?._id;

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
			providerUserId,
			sessionId: locals.sessionId,
		});

		userId = insertedId;

		// update pre-existing settings
		const { matchedCount } = await collections.settings.updateOne(authCondition(locals), {
			$set: { userId, updatedAt: new Date() },
			$unset: { sessionId: "" },
		});

		if (!matchedCount) {
			// create new default settings
			await collections.settings.insertOne({
				userId,
				ethicsModalAcceptedAt: new Date(),
				updatedAt: new Date(),
				createdAt: new Date(),
				...DEFAULT_SETTINGS,
			});
		}
	}

	// migrate pre-existing conversations
	await collections.conversations.updateMany(authCondition(locals), {
		$set: { userId },
		$unset: { sessionId: "" },
	});
}
