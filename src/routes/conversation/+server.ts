import type { RequestHandler } from "./$types";
import { collections } from "$lib/server/database";
import { ObjectId } from "mongodb";
import { error, redirect } from "@sveltejs/kit";
import { base } from "$app/paths";
import { z } from "zod";
import type { Message } from "$lib/types/Message";
import { models, validateModel } from "$lib/server/models";
import { v4 } from "uuid";
import { authCondition } from "$lib/server/auth";
import { usageLimits } from "$lib/server/usageLimits";
import { MetricsServer } from "$lib/server/metrics";
import superjson from "superjson";

export const POST: RequestHandler = async ({ locals, request }) => {
	const body = await request.text();

	let title = "";

	const parsedBody = z
		.object({
			fromShare: z.string().optional(),
			model: validateModel(models),
			preprompt: z.string().optional(),
		})
		.safeParse(JSON.parse(body));

	if (!parsedBody.success) {
		error(400, "Invalid request");
	}
	const values = parsedBody.data;

	const convCount = await collections.conversations.countDocuments(authCondition(locals));

	if (usageLimits?.conversations && convCount > usageLimits?.conversations) {
		error(429, "You have reached the maximum number of conversations. Delete some to continue.");
	}

	const model = models.find((m) => (m.id || m.name) === values.model);

	if (!model) {
		error(400, "Invalid model");
	}

	let messages: Message[] = [
		{
			id: v4(),
			from: "system",
			content: values.preprompt ?? "",
			createdAt: new Date(),
			updatedAt: new Date(),
			children: [],
			ancestors: [],
		},
	];

	let rootMessageId: Message["id"] = messages[0].id;

	if (values.fromShare) {
		const conversation = await collections.sharedConversations.findOne({
			_id: values.fromShare,
		});

		if (!conversation) {
			error(404, "Conversation not found");
		}

		// Strip <think> markers from imported titles
		title = conversation.title.replace(/<\/?think>/gi, "").trim();
		messages = conversation.messages;
		rootMessageId = conversation.rootMessageId ?? rootMessageId;
		values.model = conversation.model;
		values.preprompt = conversation.preprompt;
	}

	if (model.unlisted) {
		error(400, "Can't start a conversation with an unlisted model");
	}

	// use provided preprompt or model preprompt
	values.preprompt ??= model?.preprompt ?? "";

	if (messages && messages.length > 0 && messages[0].from === "system") {
		messages[0].content = values.preprompt;
	}

	// Always store sanitized titles
	const storedTitle = (title || "New Chat").replace(/<\/?think>/gi, "").trim();
	const now = new Date();

	const res = await collections.conversations.insertOne({
		_id: new ObjectId(),
		title: storedTitle,
		rootMessageId,
		messages,
		model: values.model,
		preprompt: values.preprompt,
		createdAt: now,
		updatedAt: now,
		userAgent: request.headers.get("User-Agent") ?? undefined,
		...(locals.user ? { userId: locals.user._id } : { sessionId: locals.sessionId }),
		...(values.fromShare ? { meta: { fromShareId: values.fromShare } } : {}),
	});

	if (MetricsServer.isEnabled()) {
		MetricsServer.getMetrics().model.conversationsTotal.inc({ model: values.model });
	}

	// Alongside the id (the stable public shape of this legacy endpoint), embed
	// the same payload GET /api/v2/conversations/[id] would return, so the
	// client can seed its conversation cache and skip the follow-up GET that
	// otherwise sits between conversation creation and the first generation
	// request. superjson-encoded (as a string field) to preserve Dates exactly
	// like the v2 endpoint does.
	const conversationId = res.insertedId.toString();
	return new Response(
		JSON.stringify({
			conversationId,
			conversation: superjson.stringify({
				messages,
				title: storedTitle,
				model: values.model,
				preprompt: values.preprompt,
				rootMessageId,
				id: conversationId,
				updatedAt: now,
				modelId: values.model,
				// Matches what GET /api/v2/conversations/[id] returns for the normal
				// post-create navigation (no fromShare query param): resolveConversation
				// only reports shared=true when the viewing URL's fromShare matches.
				shared: false,
				deployedSpaces: undefined,
			}),
		}),
		{ headers: { "Content-Type": "application/json" } }
	);
};

export const GET: RequestHandler = async () => {
	redirect(302, `${base}/`);
};
