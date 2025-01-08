import { authCondition } from "$lib/server/auth";
import { collections } from "$lib/server/database";
import { MetricsServer } from "$lib/server/metrics.js";
import { error } from "@sveltejs/kit";
import { ObjectId } from "mongodb";
import { z } from "zod";

export async function POST({ params, request, locals }) {
	const { score } = z
		.object({
			score: z.number().int().min(-1).max(1),
		})
		.parse(await request.json());
	const conversationId = new ObjectId(params.id);
	const messageId = params.messageId;

	// aggregate votes per model in order to detect model performance degradation
	const model = await collections.conversations
		.findOne(
			{
				_id: conversationId,
				...authCondition(locals),
			},
			{ projection: { model: 1 } }
		)
		.then((c) => c?.model);

	if (model) {
		if (score === 1) {
			MetricsServer.getMetrics().model.votesPositive.inc({ model });
		} else {
			MetricsServer.getMetrics().model.votesNegative.inc({ model });
		}
	}

	const document = await collections.conversations.updateOne(
		{
			_id: conversationId,
			...authCondition(locals),
			"messages.id": messageId,
		},
		{
			...(score !== 0
				? {
						$set: {
							"messages.$.score": score,
						},
				  }
				: { $unset: { "messages.$.score": "" } }),
		}
	);

	if (!document.matchedCount) {
		error(404, "Message not found");
	}

	return new Response();
}
