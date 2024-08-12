import { refreshSessionCookie } from "$lib/server/auth";
import { collections } from "$lib/server/database";
import { ObjectId } from "mongodb";
import { DEFAULT_SETTINGS } from "$lib/types/Settings";
import { z } from "zod";
import type { UserinfoResponse } from "openid-client";
import { error, type Cookies } from "@sveltejs/kit";
import crypto from "crypto";
import { sha256 } from "$lib/utils/sha256";
import { addWeeks } from "date-fns";
import { OIDConfig } from "$lib/server/auth";
import { HF_ORG_ADMIN, HF_ORG_EARLY_ACCESS } from "$env/static/private";
import { logger } from "$lib/server/logger";

const earlyAccessIds = HF_ORG_EARLY_ACCESS
	? await fetch(`https://huggingface.co/api/organizations/${HF_ORG_EARLY_ACCESS}/members`)
			.then((res) => res.json())
			.then((res: Array<{ _id: string }>) => res.map((user: { _id: string }) => user._id))
			.then((res) => {
				logger.debug(`Found ${res.length} early access members`);
				return res;
			})
			.catch((err) => {
				logger.error(err, "Failed to fetch early access members");
				return null;
			})
	: null;

const adminIds = HF_ORG_ADMIN
	? await fetch(`https://huggingface.co/api/organizations/${HF_ORG_ADMIN}/members`)
			.then((res) => res.json())
			.then((res: Array<{ _id: string }>) => res.map((user) => user._id))
			.then((res) => {
				logger.debug(`Found ${res.length} admin members`);
				return res;
			})
			.catch((err) => {
				logger.error(err, "Failed to fetch admin members");
				return null;
			})
	: null;

export async function updateUser(params: {
	userData: UserinfoResponse;
	locals: App.Locals;
	cookies: Cookies;
	userAgent?: string;
	ip?: string;
}) {
	const { userData, locals, cookies, userAgent, ip } = params;

	// Microsoft Entra v1 tokens do not provide preferred_username, instead the username is provided in the upn
	// claim. See https://learn.microsoft.com/en-us/entra/identity-platform/access-token-claims-reference
	if (!userData.preferred_username && userData.upn) {
		userData.preferred_username = userData.upn as string;
	}

	const {
		preferred_username: username,
		name,
		email,
		picture: avatarUrl,
		sub: hfUserId,
	} = z
		.object({
			preferred_username: z.string().optional(),
			name: z.string(),
			picture: z.string().optional(),
			sub: z.string(),
			email: z.string().email().optional(),
			orgs: z
				.array(
					z.object({
						sub: z.string(),
						name: z.string(),
						picture: z.string(),
						preferred_username: z.string(),
						isEnterprise: z.boolean(),
					})
				)
				.optional(),
		})
		.setKey(OIDConfig.NAME_CLAIM, z.string())
		.refine((data) => data.preferred_username || data.email, {
			message: "Either preferred_username or email must be provided by the provider.",
		})
		.transform((data) => ({
			...data,
			name: data[OIDConfig.NAME_CLAIM],
		}))
		.parse(userData) as {
		preferred_username?: string;
		email?: string;
		picture?: string;
		sub: string;
		name: string;
		orgs?: Array<{
			sub: string;
			name: string;
			picture: string;
			preferred_username: string;
			isEnterprise: boolean;
		}>;
	} & Record<string, string>;

	// Dynamically access user data based on NAME_CLAIM from environment
	// This approach allows us to adapt to different OIDC providers flexibly.

	let isAdmin = undefined;
	let isEarlyAccess = undefined;

	if (hfUserId) {
		if (adminIds !== null) {
			isAdmin = adminIds.includes(hfUserId);
		}
		if (earlyAccessIds !== null) {
			isEarlyAccess = earlyAccessIds.includes(hfUserId);
		}
	}

	logger.debug(
		{
			isAdmin,
			isEarlyAccess,
			hfUserId,
		},
		`Updating user ${hfUserId}`
	);

	// check if user already exists
	const existingUser = await collections.users.findOne({ hfUserId });
	let userId = existingUser?._id;

	// update session cookie on login
	const previousSessionId = locals.sessionId;
	const secretSessionId = crypto.randomUUID();
	const sessionId = await sha256(secretSessionId);

	if (await collections.sessions.findOne({ sessionId })) {
		error(500, "Session ID collision");
	}

	locals.sessionId = sessionId;

	if (existingUser) {
		// update existing user if any
		await collections.users.updateOne(
			{ _id: existingUser._id },
			{ $set: { username, name, avatarUrl, isAdmin, isEarlyAccess } },
			{ ignoreUndefined: true }
		);

		// remove previous session if it exists and add new one
		await collections.sessions.deleteOne({ sessionId: previousSessionId });
		await collections.sessions.insertOne({
			_id: new ObjectId(),
			sessionId: locals.sessionId,
			userId: existingUser._id,
			createdAt: new Date(),
			updatedAt: new Date(),
			userAgent,
			ip,
			expiresAt: addWeeks(new Date(), 2),
		});
	} else {
		// user doesn't exist yet, create a new one
		const { insertedId } = await collections.users.insertOne(
			{
				_id: new ObjectId(),
				createdAt: new Date(),
				updatedAt: new Date(),
				username,
				name,
				email,
				avatarUrl,
				hfUserId,
				isAdmin,
				isEarlyAccess,
			},
			{ ignoreUndefined: true }
		);

		userId = insertedId;

		await collections.sessions.insertOne({
			_id: new ObjectId(),
			sessionId: locals.sessionId,
			userId,
			createdAt: new Date(),
			updatedAt: new Date(),
			userAgent,
			ip,
			expiresAt: addWeeks(new Date(), 2),
		});

		// move pre-existing settings to new user
		const { matchedCount } = await collections.settings.updateOne(
			{ sessionId: previousSessionId },
			{
				$set: { userId, updatedAt: new Date() },
				$unset: { sessionId: "" },
			}
		);

		if (!matchedCount) {
			// if no settings found for user, create default settings
			await collections.settings.insertOne({
				userId,
				ethicsModalAcceptedAt: new Date(),
				updatedAt: new Date(),
				createdAt: new Date(),
				...DEFAULT_SETTINGS,
			});
		}
	}

	// refresh session cookie
	refreshSessionCookie(cookies, secretSessionId);

	// migrate pre-existing conversations
	await collections.conversations.updateMany(
		{ sessionId: previousSessionId },
		{
			$set: { userId },
			$unset: { sessionId: "" },
		}
	);
}
