import { collections } from "$lib/server/database";
import { error } from "@sveltejs/kit";
import { ObjectId } from "mongodb";
import { base } from "$app/paths";
import { config } from "$lib/server/config";
import { ReviewStatus } from "$lib/types/Review";
import { sendSlack } from "$lib/server/sendSlack";
import { z } from "zod";

const schema = z.object({
	status: z.nativeEnum(ReviewStatus),
});

export async function PATCH({ params, request, locals, url }) {
	const toolId = params.toolId;

	const { status } = schema.parse(await request.json());

	if (!toolId) {
		return error(400, "Tool ID is required");
	}

	const tool = await collections.tools.findOne({
		_id: new ObjectId(toolId),
	});

	if (!tool) {
		return error(404, "Tool not found");
	}

	if (
		!locals.user ||
		(!locals.isAdmin && tool.createdById.toString() !== locals.user._id.toString())
	) {
		return error(403, "Permission denied");
	}

	// only admins can set the status to APPROVED or DENIED
	// if the status is already APPROVED or DENIED, only admins can change it

	if (
		(status === ReviewStatus.APPROVED ||
			status === ReviewStatus.DENIED ||
			tool.review === ReviewStatus.APPROVED ||
			tool.review === ReviewStatus.DENIED) &&
		!locals.isAdmin
	) {
		return error(403, "Permission denied");
	}

	const result = await collections.tools.updateOne({ _id: tool._id }, { $set: { review: status } });

	if (result.modifiedCount === 0) {
		return error(500, "Failed to update review status");
	}

	if (status === ReviewStatus.PENDING) {
		const prefixUrl = config.PUBLIC_SHARE_PREFIX || `${config.PUBLIC_ORIGIN || url.origin}${base}`;
		const toolUrl = `${prefixUrl}/tools/${toolId}`;

		const username = locals.user?.username;

		await sendSlack(
			`🟢🛠️ Tool <${toolUrl}|${tool?.displayName}> requested to be featured by ${
				username ? `<http://hf.co/${username}|${username}>` : "non-logged in user"
			}.`
		);
	}

	return new Response("Review status updated", { status: 200 });
}
