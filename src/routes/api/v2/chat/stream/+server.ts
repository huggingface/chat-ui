import { authCondition } from "$lib/server/auth";
import { collections } from "$lib/server/database";
import { config } from "$lib/server/config";
import { models } from "$lib/server/models";
import { ERROR_MESSAGES } from "$lib/stores/errors";
import type { Message } from "$lib/types/Message";
import type { Conversation } from "$lib/types/Conversation";
import { error } from "@sveltejs/kit";
import { ObjectId } from "mongodb";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import {
	MessageUpdateStatus,
	MessageUpdateType,
	MessageReasoningUpdateType,
	type MessageUpdate,
} from "$lib/types/MessageUpdate";
import { usageLimits } from "$lib/server/usageLimits";
import { textGeneration } from "$lib/server/textGeneration";
import type { TextGenerationContext } from "$lib/server/textGeneration/types";
import { logger } from "$lib/server/logger.js";
import { AbortRegistry } from "$lib/server/abortRegistry";

const bodySchema = z.object({
	model: z.string().min(1),
	messages: z
		.array(
			z.object({
				from: z.enum(["user", "assistant", "system"]),
				content: z.string(),
			})
		)
		.min(1),
	preprompt: z.string().optional(),
	selectedMcpServerNames: z.array(z.string()).optional(),
	selectedMcpServers: z
		.array(
			z.object({
				name: z.string(),
				url: z.string(),
				headers: z
					.array(z.object({ key: z.string(), value: z.string() }))
					.optional()
					.default([]),
			})
		)
		.optional()
		.default([]),
	timezone: z.string().optional(),
});

export async function POST({ request, locals, getClientAddress }) {
	const promptedAt = new Date();
	const userId = locals.user?._id ?? locals.sessionId;

	if (!userId) {
		error(401, "Unauthorized");
	}

	// Rate-limiting: same protection as the standard /conversation/[id] endpoint.
	// Local-mode conversations don't get persisted, but we still need to gate inference.
	await collections.messageEvents.insertOne({
		type: "message",
		userId,
		createdAt: new Date(),
		expiresAt: new Date(Date.now() + 60_000),
		ip: getClientAddress(),
	});

	if (usageLimits?.messagesPerMinute) {
		const nEvents = Math.max(
			await collections.messageEvents.countDocuments({
				userId,
				type: "message",
				expiresAt: { $gt: new Date() },
			}),
			await collections.messageEvents.countDocuments({
				ip: getClientAddress(),
				type: "message",
				expiresAt: { $gt: new Date() },
			})
		);
		if (nEvents > usageLimits.messagesPerMinute) {
			error(429, ERROR_MESSAGES.rateLimited);
		}
	}

	const body = bodySchema.parse(await request.json());

	if (usageLimits?.messages && body.messages.length > usageLimits.messages) {
		error(
			429,
			`This conversation has more than ${usageLimits.messages} messages. Start a new one to continue`
		);
	}
	const lastUserMessage = body.messages.at(-1);
	if (
		usageLimits?.messageLength &&
		lastUserMessage &&
		lastUserMessage.content.length > usageLimits.messageLength
	) {
		error(400, "Message too long.");
	}

	const model = models.find((m) => m.id === body.model);
	if (!model) {
		error(410, "Model not available anymore");
	}

	// Build a synthetic conversation that lives only for the duration of this
	// request. We never insert it into MongoDB — the client is responsible for
	// persisting state to IndexedDB based on the streamed MessageUpdates.
	const convId = new ObjectId();
	const now = new Date();
	const hydratedMessages: Message[] = body.messages.map((m) => ({
		id: uuidv4(),
		from: m.from,
		content: m.content,
		createdAt: now,
		updatedAt: now,
	}));
	const assistantMessage: Message = {
		id: uuidv4(),
		from: "assistant",
		content: "",
		createdAt: now,
		updatedAt: now,
	};
	const conv: Conversation = {
		_id: convId,
		model: model.id,
		title: "New Chat",
		messages: [...hydratedMessages, assistantMessage],
		preprompt: body.preprompt,
		createdAt: now,
		updatedAt: now,
	};

	// Attach MCP selection to locals so the pipeline can consume it (same shape
	// as the standard /conversation/[id] endpoint).
	(locals as unknown as Record<string, unknown>).mcp = {
		selectedServerNames: body.selectedMcpServerNames,
		selectedServers: (body.selectedMcpServers ?? []).map((s) => ({
			name: s.name,
			url: s.url,
			headers:
				s.headers && s.headers.length > 0
					? Object.fromEntries(s.headers.map((h) => [h.key, h.value]))
					: undefined,
		})),
	};
	if (body.timezone) {
		(locals as unknown as Record<string, unknown>).timezone = body.timezone;
	}

	const abortRegistry = AbortRegistry.getInstance();

	let doneStreaming = false;
	let clientDetached = false;

	const stream = new ReadableStream({
		async start(controller) {
			const conversationKey = convId.toString();
			const ctrl = new AbortController();
			abortRegistry.register(conversationKey, ctrl);

			let finalAnswerReceived = false;
			let abortedByUser = false;
			let finishedStatusSent = false;
			let hasError = false;

			assistantMessage.updates ??= [];

			const initialMessageContent = assistantMessage.content;

			const update = async (event: MessageUpdate) => {
				if (
					event.type === MessageUpdateType.Status &&
					event.status === MessageUpdateStatus.Finished
				) {
					finishedStatusSent = true;
				}

				if (event.type === MessageUpdateType.Stream) {
					if (event.token === "") return;
					assistantMessage.content += event.token;
				} else if (
					event.type === MessageUpdateType.Reasoning &&
					event.subtype === MessageReasoningUpdateType.Stream &&
					"token" in event
				) {
					assistantMessage.reasoning ??= "";
					assistantMessage.reasoning += event.token;
				} else if (event.type === MessageUpdateType.FinalAnswer) {
					assistantMessage.interrupted = event.interrupted;
					assistantMessage.content = initialMessageContent + (event.text ?? "");
					finalAnswerReceived = true;
				}

				// Same length-padding as the standard endpoint to mitigate the
				// keylogging side-channel attack on streamed token packet sizes.
				if (event.type === MessageUpdateType.Stream) {
					event = { ...event, token: event.token.padEnd(16, "\0") };
				}

				if (clientDetached) return;
				try {
					controller.enqueue(JSON.stringify(event) + "\n");
					if (event.type === MessageUpdateType.FinalAnswer) {
						controller.enqueue(" ".repeat(4096));
					}
				} catch {
					clientDetached = true;
					logger.info(
						{ conversationId: convId.toString() },
						"Client detached during stateless chat stream"
					);
				}
			};

			try {
				// Pass userSettings-based overrides exactly like the standard endpoint
				// so billing/provider preferences still apply for the inference call.
				const userSettings = await collections.settings.findOne(authCondition(locals));
				locals.billingOrganization = userSettings?.billingOrganization;

				const messagesForPrompt = hydratedMessages;

				const ctx: TextGenerationContext = {
					model,
					endpoint: await model.getEndpoint(),
					conv,
					messages: messagesForPrompt,
					assistant: undefined,
					promptedAt,
					ip: getClientAddress(),
					username: locals.user?.username,
					forceMultimodal:
						!config.isHuggingChat && Boolean(userSettings?.multimodalOverrides?.[model.id]),
					forceTools: !config.isHuggingChat && Boolean(userSettings?.toolsOverrides?.[model.id]),
					provider:
						config.isHuggingChat && !model.isRouter
							? userSettings?.providerOverrides?.[model.id]
							: undefined,
					reasoningEffort:
						(userSettings?.reasoningOverrides?.[model.id] ?? model.supportsReasoning)
							? userSettings?.reasoningEffortOverrides?.[model.id]
							: undefined,
					locals,
					abortController: ctrl,
				};

				for await (const event of textGeneration(ctx)) await update(event);

				if (ctrl.signal.aborted) abortedByUser = true;
				if (abortedByUser && !finalAnswerReceived) {
					await update({
						type: MessageUpdateType.FinalAnswer,
						text: assistantMessage.content.slice(initialMessageContent.length),
						interrupted: true,
					});
				}
			} catch (e) {
				const err = e as Error;
				const isAbortError =
					err?.name === "AbortError" ||
					err?.name === "APIUserAbortError" ||
					err?.message === "Request was aborted.";
				if (isAbortError || ctrl.signal.aborted) {
					abortedByUser = true;
					if (!finalAnswerReceived) {
						await update({
							type: MessageUpdateType.FinalAnswer,
							text: assistantMessage.content.slice(initialMessageContent.length),
							interrupted: true,
						});
					}
				} else {
					hasError = true;
					const errObj = err as unknown as Record<string, unknown>;
					const statusCode =
						(typeof errObj.statusCode === "number" ? errObj.statusCode : undefined) ||
						(typeof errObj.status === "number" ? errObj.status : undefined);
					await update({
						type: MessageUpdateType.Status,
						status: MessageUpdateStatus.Error,
						message: err.message,
						...(statusCode && { statusCode }),
					});
					logger.error(err, "Error in stateless chat stream");
				}
			} finally {
				if (!hasError && !abortedByUser && assistantMessage.content === initialMessageContent) {
					hasError = true;
					await update({
						type: MessageUpdateType.Status,
						status: MessageUpdateStatus.Error,
						message: "No output was generated. Something went wrong.",
					});
				}
			}

			if (!hasError && !finishedStatusSent) {
				await update({
					type: MessageUpdateType.Status,
					status: MessageUpdateStatus.Finished,
				});
			}

			abortRegistry.unregister(conversationKey, ctrl);
			doneStreaming = true;
			if (!clientDetached) {
				controller.close();
			}
		},
		cancel() {
			if (doneStreaming) return;
			clientDetached = true;
		},
	});

	return new Response(stream, {
		headers: {
			"Content-Type": "application/jsonl",
		},
	});
}
