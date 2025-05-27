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
	const assistantId = params.id;

	const { status } = schema.parse(await request.json());

	if (!assistantId) {
		return error(400, "Assistant ID is required");
	}

	const assistant = await collections.assistants.findOne({
		_id: new ObjectId(assistantId),
	});

	if (!assistant) {
		return error(404, "Assistant not found");
	}

	if (
		!locals.user ||
		(!locals.isAdmin && assistant.createdById.toString() !== locals.user._id.toString())
	) {
		return error(403, "Permission denied");
	}

	// only admins can set the status to APPROVED or DENIED
	// if the status is already APPROVED or DENIED, only admins can change it

	if (
		(status === ReviewStatus.APPROVED ||
			status === ReviewStatus.DENIED ||
			assistant.review === ReviewStatus.APPROVED ||
			assistant.review === ReviewStatus.DENIED) &&
		!locals.isAdmin
	) {
		return error(403, "Permission denied");
	}

	const result = await collections.assistants.updateOne(
		{ _id: assistant._id },
		{ $set: { review: status } }
	);

	if (result.modifiedCount === 0) {
		return error(500, "Failed to update review status");
	}

	if (status === ReviewStatus.PENDING) {
		const prefixUrl = config.PUBLIC_SHARE_PREFIX || `${config.PUBLIC_ORIGIN || url.origin}${base}`;
		const assistantUrl = `${prefixUrl}/assistant/${assistantId}`;

		const username = locals.user?.username;

		await sendSlack(
			`🟢 Assistant <${assistantUrl}|${assistant?.name}> requested to be featured by ${
				username ? `<http://hf.co/${username}|${username}>` : "non-logged in user"
			}.`
		);
	}

	return new Response("Review status updated", { status: 200 });
}
