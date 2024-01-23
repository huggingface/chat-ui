import {
	ASSISTANTS_GENERATE_AVATAR,
	HF_TOKEN,
	IMAGE_RATE_LIMIT,
	RATE_LIMIT,
} from "$env/static/private";
import { requiresUser } from "$lib/server/auth";
import { collections } from "$lib/server/database.js";
import { ERROR_MESSAGES } from "$lib/stores/errors.js";
import { generateAvatar } from "$lib/utils/generateAvatar.js";
import { timeout } from "$lib/utils/timeout.js";
import { error } from "@sveltejs/kit";
import { z } from "zod";

const avatarSchema = z.object({
	name: z.string().min(1),
	description: z.string().optional(),
});

export async function POST({ request, locals, getClientAddress }) {
	if (ASSISTANTS_GENERATE_AVATAR !== "true" || !HF_TOKEN) {
		throw new Error("ASSISTANTS_GENERATE_AVATAR is not true, or HF_TOKEN is not set");
	}

	const userId = locals.user?._id ?? locals.sessionId;

	// rate limit check
	await collections.messageEvents.insertOne({
		userId,
		type: "image",
		createdAt: new Date(),
		ip: getClientAddress(),
	});

	const nEvents = Math.max(
		await collections.messageEvents.countDocuments({ userId, type: "image" }),
		await collections.messageEvents.countDocuments({ ip: getClientAddress(), type: "image" })
	);

	if (RATE_LIMIT != "" && nEvents > parseInt(IMAGE_RATE_LIMIT ?? RATE_LIMIT)) {
		throw error(429, ERROR_MESSAGES.rateLimited);
	}

	const formData = await request.json();

	// can only create assistants when logged in, IF login is setup
	if (!locals.user && requiresUser) {
		throw error(400, "Must be logged in. Unauthorized");
	}

	const parse = avatarSchema.safeParse(formData);

	if (!parse.success) {
		throw error(400, "Missing the name and description.");
	}

	try {
		const avatar = await timeout(generateAvatar(parse.data.description, parse.data.name), 30000);
		return new Response(avatar, {
			headers: {
				"Content-Type": "image/png",
			},
		});
	} catch (e) {
		throw error(400, "Avatar generation timed-out.");
	}
}
