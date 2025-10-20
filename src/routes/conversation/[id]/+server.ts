import { config } from "$lib/server/config";
import { authCondition, requiresUser } from "$lib/server/auth";
import { collections } from "$lib/server/database";
import { models, validModelIdSchema } from "$lib/server/models";
import { ERROR_MESSAGES } from "$lib/stores/errors";
import type { Message } from "$lib/types/Message";
import { error } from "@sveltejs/kit";
import { ObjectId } from "mongodb";
import { z } from "zod";
import {
	MessageUpdateStatus,
	MessageUpdateType,
	type MessageUpdate,
} from "$lib/types/MessageUpdate";
import { uploadFile } from "$lib/server/files/uploadFile";
import { convertLegacyConversation } from "$lib/utils/tree/convertLegacyConversation";
import { isMessageId } from "$lib/utils/tree/isMessageId";
import { buildSubtree } from "$lib/utils/tree/buildSubtree.js";
import { addChildren } from "$lib/utils/tree/addChildren.js";
import { addSibling } from "$lib/utils/tree/addSibling.js";
import { usageLimits } from "$lib/server/usageLimits";
import { textGeneration } from "$lib/server/textGeneration";
import type { TextGenerationContext } from "$lib/server/textGeneration/types";
import { logger } from "$lib/server/logger.js";
import { AbortRegistry } from "$lib/server/abortRegistry";

export async function POST({ request, locals, params, getClientAddress }) {
	const id = z.string().parse(params.id);
	const convId = new ObjectId(id);
	const promptedAt = new Date();

	const userId = locals.user?._id ?? locals.sessionId;

	// check user
	if (!userId) {
		error(401, "Unauthorized");
	}

	// check if the user has access to the conversation
	const convBeforeCheck = await collections.conversations.findOne({
		_id: convId,
		...authCondition(locals),
	});

	if (convBeforeCheck && !convBeforeCheck.rootMessageId) {
		const res = await collections.conversations.updateOne(
			{
				_id: convId,
			},
			{
				$set: {
					...convBeforeCheck,
					...convertLegacyConversation(convBeforeCheck),
				},
			}
		);

		if (!res.acknowledged) {
			error(500, "Failed to convert conversation");
		}
	}

	const conv = await collections.conversations.findOne({
		_id: convId,
		...authCondition(locals),
	});

	if (!conv) {
		error(404, "Conversation not found");
	}

	// register the event for ratelimiting
	await collections.messageEvents.insertOne({
		type: "message",
		userId,
		createdAt: new Date(),
		expiresAt: new Date(Date.now() + 60_000),
		ip: getClientAddress(),
	});

	const messagesBeforeLogin = config.MESSAGES_BEFORE_LOGIN
		? parseInt(config.MESSAGES_BEFORE_LOGIN)
		: 0;

	// guest mode check
	if (!locals.user?._id && requiresUser && messagesBeforeLogin) {
		const totalMessages =
			(
				await collections.conversations
					.aggregate([
						{ $match: { ...authCondition(locals), "messages.from": "assistant" } },
						{ $project: { messages: 1 } },
						{ $limit: messagesBeforeLogin + 1 },
						{ $unwind: "$messages" },
						{ $match: { "messages.from": "assistant" } },
						{ $count: "messages" },
					])
					.toArray()
			)[0]?.messages ?? 0;

		if (totalMessages > messagesBeforeLogin) {
			error(429, "Exceeded number of messages before login");
		}
	}
	if (usageLimits?.messagesPerMinute) {
		// check if the user is rate limited
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

	if (usageLimits?.messages && conv.messages.length > usageLimits.messages) {
		error(
			429,
			`This conversation has more than ${usageLimits.messages} messages. Start a new one to continue`
		);
	}

	// fetch the model
	const model = models.find((m) => m.id === conv.model);

	if (!model) {
		error(410, "Model not available anymore");
	}

	// finally parse the content of the request
	const form = await request.formData();

	const json = form.get("data");

	if (!json || typeof json !== "string") {
		error(400, "Invalid request");
	}

	const {
		inputs: newPrompt,
		id: messageId,
		is_retry: isRetry,
	} = z
		.object({
			id: z.string().uuid().refine(isMessageId).optional(), // parent message id to append to for a normal message, or the message id for a retry/continue
			inputs: z.optional(
				z
					.string()
					.min(1)
					.transform((s) => s.replace(/\r\n/g, "\n"))
			),
			is_retry: z.optional(z.boolean()),
			files: z.optional(
				z.array(
					z.object({
						type: z.literal("base64").or(z.literal("hash")),
						name: z.string(),
						value: z.string(),
						mime: z.string(),
					})
				)
			),
		})
		.parse(JSON.parse(json));

	const inputFiles = await Promise.all(
		form
			.getAll("files")
			.filter((entry): entry is File => entry instanceof File && entry.size > 0)
			.map(async (file) => {
				const [type, ...name] = file.name.split(";");

				return {
					type: z.literal("base64").or(z.literal("hash")).parse(type),
					value: await file.text(),
					mime: file.type,
					name: name.join(";"),
				};
			})
	);

	if (usageLimits?.messageLength && (newPrompt?.length ?? 0) > usageLimits.messageLength) {
		error(400, "Message too long.");
	}

	// each file is either:
	// base64 string requiring upload to the server
	// hash pointing to an existing file
	const hashFiles = inputFiles?.filter((file) => file.type === "hash") ?? [];
	const b64Files =
		inputFiles
			?.filter((file) => file.type !== "hash")
			.map((file) => {
				const blob = Buffer.from(file.value, "base64");
				return new File([blob], file.name, { type: file.mime });
			}) ?? [];

	// check sizes
	// todo: make configurable
	if (b64Files.some((file) => file.size > 10 * 1024 * 1024)) {
		error(413, "File too large, should be <10MB");
	}

	const uploadedFiles = await Promise.all(b64Files.map((file) => uploadFile(file, conv))).then(
		(files) => [...files, ...hashFiles]
	);

	// we will append tokens to the content of this message
	let messageToWriteToId: Message["id"] | undefined = undefined;
	// used for building the prompt, subtree of the conversation that goes from the latest message to the root
	let messagesForPrompt: Message[] = [];

	if (isRetry && messageId) {
		// two cases, if we're retrying a user message with a newPrompt set,
		// it means we're editing a user message
		// if we're retrying on an assistant message, newPrompt cannot be set
		// it means we're retrying the last assistant message for a new answer

		const messageToRetry = conv.messages.find((message) => message.id === messageId);

		if (!messageToRetry) {
			error(404, "Message not found");
		}

		if (messageToRetry.from === "user" && newPrompt) {
			// add a sibling to this message from the user, with the alternative prompt
			// add a children to that sibling, where we can write to
			const newUserMessageId = addSibling(
				conv,
				{
					from: "user",
					content: newPrompt,
					files: uploadedFiles,
					createdAt: new Date(),
					updatedAt: new Date(),
				},
				messageId
			);
			messageToWriteToId = addChildren(
				conv,
				{
					from: "assistant",
					content: "",
					createdAt: new Date(),
					updatedAt: new Date(),
				},
				newUserMessageId
			);
			messagesForPrompt = buildSubtree(conv, newUserMessageId);
		} else if (messageToRetry.from === "assistant") {
			// we're retrying an assistant message, to generate a new answer
			// just add a sibling to the assistant answer where we can write to
			messageToWriteToId = addSibling(
				conv,
				{ from: "assistant", content: "", createdAt: new Date(), updatedAt: new Date() },
				messageId
			);
			messagesForPrompt = buildSubtree(conv, messageId);
			messagesForPrompt.pop(); // don't need the latest assistant message in the prompt since we're retrying it
		}
	} else {
		// just a normal linear conversation, so we add the user message
		// and the blank assistant message back to back
		const newUserMessageId = addChildren(
			conv,
			{
				from: "user",
				content: newPrompt ?? "",
				files: uploadedFiles,
				createdAt: new Date(),
				updatedAt: new Date(),
			},
			messageId
		);

		messageToWriteToId = addChildren(
			conv,
			{
				from: "assistant",
				content: "",
				createdAt: new Date(),
				updatedAt: new Date(),
			},
			newUserMessageId
		);
		// build the prompt from the user message
		messagesForPrompt = buildSubtree(conv, newUserMessageId);
	}

	const messageToWriteTo = conv.messages.find((message) => message.id === messageToWriteToId);
	if (!messageToWriteTo) {
		error(500, "Failed to create message");
	}
	if (messagesForPrompt.length === 0) {
		error(500, "Failed to create prompt");
	}

	// update the conversation with the new messages
	await collections.conversations.updateOne(
		{ _id: convId },
		{ $set: { messages: conv.messages, title: conv.title, updatedAt: new Date() } }
	);

	let doneStreaming = false;
	let clientDetached = false;

	let lastTokenTimestamp: undefined | Date = undefined;

	const persistConversation = async () => {
		await collections.conversations.updateOne(
			{ _id: convId },
			{ $set: { messages: conv.messages, title: conv.title, updatedAt: new Date() } }
		);
	};

	const abortRegistry = AbortRegistry.getInstance();

	// we now build the stream
	const stream = new ReadableStream({
		async start(controller) {
			const conversationKey = convId.toString();
			const ctrl = new AbortController();
			abortRegistry.register(conversationKey, ctrl);

			let finalAnswerReceived = false;
			let abortedByUser = false;

			messageToWriteTo.updates ??= [];
			async function update(event: MessageUpdate) {
				if (!messageToWriteTo || !conv) {
					throw Error("No message or conversation to write events to");
				}

				// Add token to content or skip if empty
				if (event.type === MessageUpdateType.Stream) {
					if (event.token === "") return;
					messageToWriteTo.content += event.token;

					if (!lastTokenTimestamp) {
						lastTokenTimestamp = new Date();
					}
					lastTokenTimestamp = new Date();
				}

				// Set the title
				else if (event.type === MessageUpdateType.Title) {
					// Always strip <think> markers from titles when saving
					const sanitizedTitle = event.title.replace(/<\/?think>/gi, "").trim();
					conv.title = sanitizedTitle;
					await collections.conversations.updateOne(
						{ _id: convId },
						{ $set: { title: conv?.title, updatedAt: new Date() } }
					);
				}

				// Set the final text and the interrupted flag
				else if (event.type === MessageUpdateType.FinalAnswer) {
					messageToWriteTo.interrupted = event.interrupted;
					messageToWriteTo.content = initialMessageContent + event.text;
					finalAnswerReceived = true;
				}

				// Add file
				else if (event.type === MessageUpdateType.File) {
					messageToWriteTo.files = [
						...(messageToWriteTo.files ?? []),
						{ type: "hash", name: event.name, value: event.sha, mime: event.mime },
					];
				}

				// Store router metadata (for router models) or provider info (for all models)
				else if (event.type === MessageUpdateType.RouterMetadata) {
					// Merge metadata updates to preserve existing fields (router may send route/model first, then provider comes later)
					if (model?.isRouter) {
						messageToWriteTo.routerMetadata = {
							route: event.route || messageToWriteTo.routerMetadata?.route || "",
							model: event.model || messageToWriteTo.routerMetadata?.model || "",
							provider: event.provider || messageToWriteTo.routerMetadata?.provider,
						};
					}
					// Store provider-only metadata for non-router models if available
					else if (event.provider) {
						messageToWriteTo.routerMetadata = {
							route: messageToWriteTo.routerMetadata?.route || "",
							model: messageToWriteTo.routerMetadata?.model || "",
							provider: event.provider,
						};
					}
				}

				// Append to the persistent message updates if it's not a stream update
				if (
					event.type !== MessageUpdateType.Stream &&
					!(
						event.type === MessageUpdateType.Status &&
						event.status === MessageUpdateStatus.KeepAlive
					)
				) {
					messageToWriteTo?.updates?.push(event);
				}

				// Avoid remote keylogging attack executed by watching packet lengths
				// by padding the text with null chars to a fixed length
				// https://cdn.arstechnica.net/wp-content/uploads/2024/03/LLM-Side-Channel.pdf
				if (event.type === MessageUpdateType.Stream) {
					event = { ...event, token: event.token.padEnd(16, "\0") };
				}

				messageToWriteTo.updatedAt = new Date();

				const enqueueUpdate = async () => {
					if (clientDetached) return;
					try {
						controller.enqueue(JSON.stringify(event) + "\n");
						if (event.type === MessageUpdateType.FinalAnswer) {
							controller.enqueue(" ".repeat(4096));
						}
					} catch (err) {
						clientDetached = true;
						logger.info(
							{ conversationId: convId.toString() },
							"Client detached during message streaming"
						);
					}
				};

				await enqueueUpdate();

				if (clientDetached) {
					await persistConversation();
				}
			}

			let hasError = false;
			const initialMessageContent = messageToWriteTo.content;

			try {
				const ctx: TextGenerationContext = {
					model,
					endpoint: await model.getEndpoint(),
					conv,
					messages: messagesForPrompt,
					assistant: undefined,
					promptedAt,
					ip: getClientAddress(),
					username: locals.user?.username,
					// Force-enable multimodal if user settings say so for this model
					forceMultimodal: Boolean(
						(await collections.settings.findOne(authCondition(locals)))?.multimodalOverrides?.[
							model.id
						]
					),
					locals,
					abortController: ctrl,
				};
				// run the text generation and send updates to the client
				for await (const event of textGeneration(ctx)) await update(event);
				if (ctrl.signal.aborted) {
					abortedByUser = true;
				}
				if (abortedByUser && !finalAnswerReceived) {
					const partialText = messageToWriteTo.content.slice(initialMessageContent.length);
					await update({
						type: MessageUpdateType.FinalAnswer,
						text: partialText,
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
					logger.info({ conversationId: conversationKey }, "Generation aborted by user");
					if (!finalAnswerReceived) {
						const partialText = messageToWriteTo.content.slice(initialMessageContent.length);
						await update({
							type: MessageUpdateType.FinalAnswer,
							text: partialText,
							interrupted: true,
						});
					}
				} else {
					hasError = true;
					// Extract status code if available from HTTPError or APIError
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
					logger.error(err);
				}
			} finally {
				// check if no output was generated
				if (!hasError && !abortedByUser && messageToWriteTo.content === initialMessageContent) {
					await update({
						type: MessageUpdateType.Status,
						status: MessageUpdateStatus.Error,
						message: "No output was generated. Something went wrong.",
					});
				}
			}

			await persistConversation();
			abortRegistry.unregister(conversationKey, ctrl);

			// used to detect if cancel() is called bc of interrupt or just because the connection closes
			doneStreaming = true;
			if (!clientDetached) {
				controller.close();
			}
		},
		async cancel() {
			if (doneStreaming) return;
			clientDetached = true;
			await persistConversation();
		},
	});

	// Todo: maybe we should wait for the message to be saved before ending the response - in case of errors
	return new Response(stream, {
		headers: {
			"Content-Type": "application/jsonl",
		},
	});
}

export async function DELETE({ locals, params }) {
	const convId = new ObjectId(params.id);

	const conv = await collections.conversations.findOne({
		_id: convId,
		...authCondition(locals),
	});

	if (!conv) {
		error(404, "Conversation not found");
	}

	await collections.conversations.deleteOne({ _id: conv._id });

	return new Response();
}

export async function PATCH({ request, locals, params }) {
	const values = z
		.object({
			title: z.string().trim().min(1).max(100).optional(),
			model: validModelIdSchema.optional(),
		})
		.parse(await request.json());

	const convId = new ObjectId(params.id);

	const conv = await collections.conversations.findOne({
		_id: convId,
		...authCondition(locals),
	});

	if (!conv) {
		error(404, "Conversation not found");
	}

	// Only include defined values in the update, with title sanitized
	const updateValues = {
		...(values.title !== undefined && {
			title: values.title.replace(/<\/?think>/gi, "").trim(),
		}),
		...(values.model !== undefined && { model: values.model }),
	};

	await collections.conversations.updateOne(
		{
			_id: convId,
		},
		{
			$set: updateValues,
		}
	);

	return new Response();
}
