import type { RequestHandler } from "./$types";
import { collections } from "$lib/server/database";
import { logger } from "$lib/server/logger";
import { isTurnAlive } from "$lib/server/generation/turnLog";
import { abortRunningTurn } from "$lib/server/generation/stopConversation";
import { ownedMlConversation } from "$lib/server/queuedInputs/access";
import { wakeParkForQueuedInput } from "$lib/server/queuedInputs/deliver";
import { kickQueuedTurn } from "$lib/server/queuedInputs/drain";
import { hasQueuedInputs } from "$lib/server/queuedInputs/store";
import { error, json } from "@sveltejs/kit";

/**
 * send what is queued now instead of at the next step, the running step is stopped and the turn
 * that ends hands the queue to the next one
 */
export const POST: RequestHandler = async ({ params, locals }) => {
	const conversationId = await ownedMlConversation(params, locals);
	if (!(await hasQueuedInputs(conversationId))) error(409, "Nothing is queued");

	const conversation = await collections.conversations.findOne(
		{ _id: conversationId },
		{ projection: { messages: { $slice: -1 } } }
	);
	const latest = conversation?.messages.at(-1);
	const turn =
		latest?.from === "assistant" ? await isTurnAlive(conversationId, latest.id) : undefined;

	if (turn?.status === "running") {
		await abortRunningTurn(conversationId);
	} else if (turn?.status === "parked") {
		await wakeParkForQueuedInput(conversationId);
		const { sweepParkedCalls } = await import("$lib/server/generation/parkedSweeper");
		void sweepParkedCalls().catch((err) =>
			logger.error({ err }, "[parked] the sweep kicked by a send now failed")
		);
	} else {
		kickQueuedTurn(conversationId);
	}
	return json({ ok: true });
};
