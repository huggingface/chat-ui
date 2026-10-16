import type { RequestHandler } from "./$types";
import { error } from "@sveltejs/kit";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { authCondition } from "$lib/server/auth";
import { collections } from "$lib/server/database";
import { logger } from "$lib/server/logger";
import { isMlAssistantConversation } from "$lib/server/mlAssistant";
import { answerSideQuestion, SIDE_QUESTION_MAX_CHARS } from "$lib/server/mlSideQuestion";
import { usageLimits } from "$lib/server/usageLimits";
import { ERROR_MESSAGES } from "$lib/stores/errors";

const bodySchema = z.object({
	question: z.string().trim().min(1).max(SIDE_QUESTION_MAX_CHARS),
});

/** a side question about the run, answered from the stored conversation and never stored itself */
export const POST: RequestHandler = async ({ params, locals, request, getClientAddress }) => {
	const userId = locals.user?._id ?? locals.sessionId;
	if (!userId) error(401, "Unauthorized");

	if (!ObjectId.isValid(params.id)) error(404, "Conversation not found");
	const conversationId = new ObjectId(params.id);

	const conversation = await collections.conversations.findOne(
		{ _id: conversationId, ...authCondition(locals) },
		{ projection: { _id: 1, mlAssistant: 1 } }
	);
	if (!conversation) error(404, "Conversation not found");
	if (!isMlAssistantConversation(conversation)) {
		error(400, "Side questions are only available in ML Intern conversations");
	}

	const parsed = bodySchema.safeParse(await request.json().catch(() => null));
	if (!parsed.success) error(400, "Invalid side question");

	if (usageLimits?.messagesPerMinute) {
		await collections.messageEvents.insertOne({
			type: "message",
			userId,
			createdAt: new Date(),
			expiresAt: new Date(Date.now() + 60_000),
			ip: getClientAddress(),
		});
		const recent = await collections.messageEvents.countDocuments({
			userId,
			type: "message",
			expiresAt: { $gt: new Date() },
		});
		if (recent > usageLimits.messagesPerMinute) error(429, ERROR_MESSAGES.rateLimited);
	}

	const settings = await collections.settings.findOne(authCondition(locals));
	locals.billingOrganization = settings?.billingOrganization;
	locals.billingResourceGroup = settings?.billingResourceGroup;

	const abort = new AbortController();
	request.signal.addEventListener("abort", () => abort.abort(), { once: true });
	const answer = answerSideQuestion({
		conversationId,
		question: parsed.data.question,
		locals,
		providerOverrides: settings?.providerOverrides,
		signal: abort.signal,
	});
	const encoder = new TextEncoder();
	const fail = (err: unknown) => {
		if (!abort.signal.aborted) {
			logger.warn({ err: String(err), conversationId: params.id }, "[btw] answer failed");
		}
	};

	// the first chunk is awaited here so an upstream refusal is an error status, not an empty 200
	let first: IteratorResult<string, void>;
	try {
		first = await answer.next();
	} catch (err) {
		fail(err);
		error(502, "Could not answer the side question");
	}

	return new Response(
		new ReadableStream<Uint8Array>({
			start(controller) {
				if (first.done) controller.close();
				else controller.enqueue(encoder.encode(first.value));
			},
			async pull(controller) {
				try {
					const next = await answer.next();
					if (next.done) controller.close();
					else controller.enqueue(encoder.encode(next.value));
				} catch (err) {
					fail(err);
					controller.error(err);
				}
			},
			cancel() {
				abort.abort();
			},
		}),
		{
			headers: {
				"Content-Type": "text/plain; charset=utf-8",
				"Cache-Control": "no-store",
				"X-Accel-Buffering": "no",
			},
		}
	);
};
