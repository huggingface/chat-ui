import type { RequestHandler } from "./$types";
import { authCondition } from "$lib/server/auth";
import { collections } from "$lib/server/database";
import { submitElicitationAnswer } from "$lib/server/mcp/elicitation";
import { kickAnsweredAsk } from "$lib/server/generation/askResume";
import { error, json } from "@sveltejs/kit";
import { ObjectId } from "mongodb";
import { z } from "zod";

const bodySchema = z.object({
	elicitationId: z.string().uuid(),
	action: z.enum(["accept", "decline", "cancel"]),
	/** Only shape-checked here; the real check is against the stored requested schema. */
	content: z
		.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]))
		.optional(),
	/**
	 * The browser's tool selection, in the message route's shape. The turn an answer continues
	 * runs from here rather than from a message request, which is where it used to arrive.
	 */
	selectedMcpServerNames: z.array(z.string()).optional(),
	selectedMcpServers: z
		.array(
			z.object({
				name: z.string(),
				url: z.string(),
				headers: z.array(z.object({ key: z.string(), value: z.string() })).optional(),
			})
		)
		.optional(),
	timezone: z.string().optional(),
});

/** Separate from the generation stream: the run holding the tool call may be on another pod. */
export const POST: RequestHandler = async ({ params, locals, request }) => {
	if (!locals.user && !locals.sessionId) error(401, "Unauthorized");

	if (!ObjectId.isValid(params.id)) error(404, "Conversation not found");
	const conversationId = new ObjectId(params.id);

	const conversation = await collections.conversations.findOne(
		{ _id: conversationId, ...authCondition(locals) },
		{ projection: { _id: 1 } }
	);
	if (!conversation) error(404, "Conversation not found");

	const parsed = bodySchema.safeParse(await request.json().catch(() => null));
	if (!parsed.success) error(400, "Invalid elicitation response");

	const result = await submitElicitationAnswer({
		elicitationId: parsed.data.elicitationId,
		conversationId,
		action: parsed.data.action,
		content: parsed.data.content,
	});

	// The model's own question is continued here, by the server, so the turn does not hinge on
	// this browser surviving to make a second request. `resume` is the instruction to the
	// CLIENT to start the continuation, so it goes out false: a client from before this change
	// reads that as nothing to do and follows the turn through its subscription, like any
	// other. Awaited only until the answer is stored; the run itself outlives the request.
	const serverResumes = result.ok
		? result.resume && result.pendingKind === "ask"
		: result.status === 409 && result.answered?.resume === true && result.pendingKind === "ask";
	if (serverResumes) {
		const { selectedMcpServerNames, selectedMcpServers, timezone } = parsed.data;
		await kickAnsweredAsk(conversationId, parsed.data.elicitationId, {
			...(selectedMcpServerNames ? { selectedServerNames: selectedMcpServerNames } : {}),
			...(selectedMcpServers
				? {
						selectedServers: selectedMcpServers.map((server) => ({
							name: server.name,
							url: server.url,
							...(server.headers?.length
								? { headers: Object.fromEntries(server.headers.map((h) => [h.key, h.value])) }
								: {}),
						})),
					}
				: {}),
			...(timezone ? { timezone } : {}),
		});
	}

	if (!result.ok) {
		if (result.status === 409 && result.answered) {
			const answered = serverResumes ? { ...result.answered, resume: false } : result.answered;
			return json({ ok: false, message: result.error, answered }, { status: 409 });
		}
		error(result.status, result.error);
	}

	// A parked 2026-era MCP call resumes on a fresh run the client starts; a blocking prompt is
	// already unblocked.
	return json({
		ok: true,
		resume: result.resume && !serverResumes,
		messageId: result.messageId,
	});
};
