import { base } from "$app/paths";

import { collections } from "$lib/server/database";
import { error } from "@sveltejs/kit";
import { ObjectId } from "mongodb";
import { z } from "zod";

import { config } from "$lib/server/config";
import { sendSlack } from "$lib/server/sendSlack";
import type { Assistant } from "$lib/types/Assistant";

export async function POST({ params, request, locals, url }) {
	// is there already a report from this user for this model ?
	const report = await collections.reports.findOne({
		createdBy: locals.user?._id ?? locals.sessionId,
		object: "assistant",
		contentId: new ObjectId(params.id),
	});

	if (report) {
		return error(400, "Already reported");
	}

	const { reason } = z.object({ reason: z.string().min(1).max(128) }).parse(await request.json());

	if (!reason) {
		return error(400, "Invalid report reason");
	}

	const { acknowledged } = await collections.reports.insertOne({
		_id: new ObjectId(),
		contentId: new ObjectId(params.id),
		object: "assistant",
		createdBy: locals.user?._id ?? locals.sessionId,
		createdAt: new Date(),
		updatedAt: new Date(),
		reason,
	});

	if (!acknowledged) {
		return error(500, "Failed to report assistant");
	}

	if (config.WEBHOOK_URL_REPORT_ASSISTANT) {
		const prefixUrl = config.PUBLIC_SHARE_PREFIX || `${config.PUBLIC_ORIGIN || url.origin}${base}`;
		const assistantUrl = `${prefixUrl}/assistant/${params.id}`;

		const assistant = await collections.assistants.findOne<Pick<Assistant, "name">>(
			{ _id: new ObjectId(params.id) },
			{ projection: { name: 1 } }
		);

		const username = locals.user?.username;

		await sendSlack(
			`🔴 Assistant <${assistantUrl}|${assistant?.name}> reported by ${
				username ? `<http://hf.co/${username}|${username}>` : "non-logged in user"
			}.\n\n> ${reason}`
		);
	}

	return new Response("Assistant reported", { status: 200 });
}
