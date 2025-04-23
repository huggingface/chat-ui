import { base } from "$app/paths";

import { collections } from "$lib/server/database";
import { error } from "@sveltejs/kit";
import { ObjectId } from "mongodb";
import { z } from "zod";

import { config } from "$lib/server/config";
import { sendSlack } from "$lib/server/sendSlack";
import type { Tool } from "$lib/types/Tool";

export async function POST({ params, request, locals, url }) {
	// is there already a report from this user for this model ?
	const report = await collections.reports.findOne({
		createdBy: locals.user?._id ?? locals.sessionId,
		object: "tool",
		contentId: new ObjectId(params.toolId),
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
		contentId: new ObjectId(params.toolId),
		object: "tool",
		createdBy: locals.user?._id ?? locals.sessionId,
		createdAt: new Date(),
		updatedAt: new Date(),
		reason,
	});

	if (!acknowledged) {
		return error(500, "Failed to report tool");
	}

	if (config.WEBHOOK_URL_REPORT_ASSISTANT) {
		const prefixUrl = config.PUBLIC_SHARE_PREFIX || `${config.PUBLIC_ORIGIN || url.origin}${base}`;
		const toolUrl = `${prefixUrl}/tools/${params.toolId}`;

		const tool = await collections.tools.findOne<Pick<Tool, "displayName" | "name">>(
			{ _id: new ObjectId(params.toolId) },
			{ projection: { displayName: 1, name: 1 } }
		);

		const username = locals.user?.username;

		await sendSlack(
			`🔴 Tool <${toolUrl}|${tool?.displayName ?? tool?.name}> reported by ${
				username ? `<http://hf.co/${username}|${username}>` : "non-logged in user"
			}.\n\n> ${reason}`
		);
	}

	return new Response("Tool reported", { status: 200 });
}
