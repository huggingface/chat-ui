import { MESSAGES_BEFORE_LOGIN, ENABLE_ASSISTANTS_RAG } from "$env/static/private";
import { startOfHour } from "date-fns";
import { authCondition, requiresUser } from "$lib/server/auth";
import { collections } from "$lib/server/database";
import { models } from "$lib/server/models";
import { ERROR_MESSAGES } from "$lib/stores/errors";
import type { Message } from "$lib/types/Message";
import { error } from "@sveltejs/kit";
import { ObjectId } from "mongodb";
import { z } from "zod";
import type { MessageUpdate } from "$lib/types/MessageUpdate";
import { runWebSearch } from "$lib/server/websearch/runWebSearch";
import { abortedGenerations } from "$lib/server/abortedGenerations";
import { summarize } from "$lib/server/summarize";
import { uploadFile } from "$lib/server/files/uploadFile";
import sizeof from "image-size";
import type { Assistant } from "$lib/types/Assistant";
import { convertLegacyConversation } from "$lib/utils/tree/convertLegacyConversation";
import { isMessageId } from "$lib/utils/tree/isMessageId";
import { buildSubtree } from "$lib/utils/tree/buildSubtree.js";
import { addChildren } from "$lib/utils/tree/addChildren.js";
import { addSibling } from "$lib/utils/tree/addSibling.js";
import { preprocessMessages } from "$lib/server/preprocessMessages.js";
import { usageLimits } from "$lib/server/usageLimits";
import { isURLLocal } from "$lib/server/isURLLocal.js";

export async function POST({ request, locals, params, getClientAddress }) {
	const id = z.string().parse(params.id);
	const convId = new ObjectId(id);
	const promptedAt = new Date();

	const userId = locals.user?._id ?? locals.sessionId;

	// check user
	if (!userId) {
		throw error(401, "Unauthorized");
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
			throw error(500, "Failed to convert conversation");
		}
	}

	const conv = await collections.conversations.findOne({
		_id: convId,
		...authCondition(locals),
	});

	if (!conv) {
		throw error(404, "Conversation not found");
	}

	// register the event for ratelimiting
	await collections.messageEvents.insertOne({
		userId,
		createdAt: new Date(),
		ip: getClientAddress(),
	});

	const messagesBeforeLogin = MESSAGES_BEFORE_LOGIN ? parseInt(MESSAGES_BEFORE_LOGIN) : 0;

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
			throw error(429, "Exceeded number of messages before login");
		}
	}

	if (usageLimits?.messagesPerMinute) {
		// check if the user is rate limited
		const nEvents = Math.max(
			await collections.messageEvents.countDocuments({ userId }),
			await collections.messageEvents.countDocuments({ ip: getClientAddress() })
		);
		if (nEvents > usageLimits.messagesPerMinute) {
			throw error(429, ERROR_MESSAGES.rateLimited);
		}
	}

	if (usageLimits?.messages && conv.messages.length > usageLimits.messages) {
		throw error(
			429,
			`This conversation has more than ${usageLimits.messages} messages. Start a new one to continue`
		);
	}

	// fetch the model
	const model = models.find((m) => m.id === conv.model);

	if (!model) {
		throw error(410, "Model not available anymore");
	}

	// finally parse the content of the request
	const json = await request.json();

	const {
		inputs: newPrompt,
		id: messageId,
		is_retry: isRetry,
		is_continue: isContinue,
		web_search: webSearch,
		files: b64files,
	} = z
		.object({
			id: z.string().uuid().refine(isMessageId).optional(), // parent message id to append to for a normal message, or the message id for a retry/continue
			inputs: z.optional(
				z
					.string()
					.trim()
					.min(1)
					.transform((s) => s.replace(/\r\n/g, "\n"))
			),
			is_retry: z.optional(z.boolean()),
			is_continue: z.optional(z.boolean()),
			web_search: z.optional(z.boolean()),
			files: z.optional(z.array(z.string())),
		})
		.parse(json);

	if (usageLimits?.messageLength && (newPrompt?.length ?? 0) > usageLimits.messageLength) {
		throw error(400, "Message too long.");
	}
	// files is an array of base64 strings encoding Blob objects
	// we need to convert this array to an array of File objects

	const files = b64files?.map((file) => {
		const blob = Buffer.from(file, "base64");
		return new File([blob], "image.png");
	});

	// check sizes
	if (files) {
		const filechecks = await Promise.all(
			files.map(async (file) => {
				const dimensions = sizeof(Buffer.from(await file.arrayBuffer()));
				return (
					file.size > 2 * 1024 * 1024 ||
					(dimensions.width ?? 0) > 224 ||
					(dimensions.height ?? 0) > 224
				);
			})
		);

		if (filechecks.some((check) => check)) {
			throw error(413, "File too large, should be <2MB and 224x224 max.");
		}
	}

	let hashes: undefined | string[];

	if (files) {
		hashes = await Promise.all(files.map(async (file) => await uploadFile(file, conv)));
	}

	// we will append tokens to the content of this message
	let messageToWriteToId: Message["id"] | undefined = undefined;
	// used for building the prompt, subtree of the conversation that goes from the latest message to the root
	let messagesForPrompt: Message[] = [];

	if (isContinue && messageId) {
		// if it's the last message and we continue then we build the prompt up to the last message
		// we will strip the end tokens afterwards when the prompt is built
		if ((conv.messages.find((msg) => msg.id === messageId)?.children?.length ?? 0) > 0) {
			throw error(400, "Can only continue the last message");
		}
		messageToWriteToId = messageId;
		messagesForPrompt = buildSubtree(conv, messageId);
	} else if (isRetry && messageId) {
		// two cases, if we're retrying a user message with a newPrompt set,
		// it means we're editing a user message
		// if we're retrying on an assistant message, newPrompt cannot be set
		// it means we're retrying the last assistant message for a new answer

		const messageToRetry = conv.messages.find((message) => message.id === messageId);

		if (!messageToRetry) {
			throw error(404, "Message not found");
		}

		if (messageToRetry.from === "user" && newPrompt) {
			// add a sibling to this message from the user, with the alternative prompt
			// add a children to that sibling, where we can write to
			const newUserMessageId = addSibling(
				conv,
				{ from: "user", content: newPrompt, createdAt: new Date(), updatedAt: new Date() },
				messageId
			);
			messageToWriteToId = addChildren(
				conv,
				{
					from: "assistant",
					content: "",
					files: hashes,
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
				files: hashes,
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
		throw error(500, "Failed to create message");
	}
	if (messagesForPrompt.length === 0) {
		throw error(500, "Failed to create prompt");
	}

	// update the conversation with the new messages
	await collections.conversations.updateOne(
		{
			_id: convId,
		},
		{
			$set: {
				messages: conv.messages,
				title: conv.title,
				updatedAt: new Date(),
			},
		}
	);

	let doneStreaming = false;

	// we now build the stream
	const stream = new ReadableStream({
		async start(controller) {
			messageToWriteTo.updates ??= [];
			function update(newUpdate: MessageUpdate) {
				if (newUpdate.type !== "stream") {
					messageToWriteTo?.updates?.push(newUpdate);
				}

				if (newUpdate.type === "stream" && newUpdate.token === "") {
					return;
				}
				controller.enqueue(JSON.stringify(newUpdate) + "\n");

				if (newUpdate.type === "finalAnswer") {
					// 4096 of spaces to make sure the browser doesn't blocking buffer that holding the response
					controller.enqueue(" ".repeat(4096));
				}
			}

			update({ type: "status", status: "started" });

			const summarizeIfNeeded = (async () => {
				if (conv.title === "New Chat" && conv.messages.length === 3) {
					try {
						conv.title = (await summarize(conv.messages[1].content)) ?? conv.title;
						update({ type: "status", status: "title", message: conv.title });
						await collections.conversations.updateOne(
							{
								_id: convId,
							},
							{
								$set: {
									title: conv?.title,
									updatedAt: new Date(),
								},
							}
						);
					} catch (e) {
						console.error(e);
					}
				}
			})();

			await collections.conversations.updateOne(
				{
					_id: convId,
				},
				{
					$set: {
						title: conv.title,
						updatedAt: new Date(),
					},
				}
			);

			// check if assistant has a rag
			const assistant = await collections.assistants.findOne<
				Pick<Assistant, "rag" | "dynamicPrompt" | "generateSettings">
			>(
				{ _id: conv.assistantId },
				{ projection: { rag: 1, dynamicPrompt: 1, generateSettings: 1 } }
			);

			const assistantHasDynamicPrompt =
				ENABLE_ASSISTANTS_RAG === "true" && !!assistant && !!assistant?.dynamicPrompt;

			const assistantHasWebSearch =
				ENABLE_ASSISTANTS_RAG === "true" &&
				!!assistant &&
				!!assistant.rag &&
				(assistant.rag.allowedLinks.length > 0 ||
					assistant.rag.allowedDomains.length > 0 ||
					assistant.rag.allowAllDomains);

			// perform websearch if needed
			if (!isContinue && (webSearch || assistantHasWebSearch)) {
				messageToWriteTo.webSearch = await runWebSearch(
					conv,
					messagesForPrompt,
					update,
					assistant?.rag
				);
			}

			let preprompt = conv.preprompt;

			if (assistantHasDynamicPrompt && preprompt) {
				// process the preprompt
				const urlRegex = /{{\s?url=(.*?)\s?}}/g;
				let match;
				while ((match = urlRegex.exec(preprompt)) !== null) {
					try {
						const url = new URL(match[1]);
						if (await isURLLocal(url)) {
							throw new Error("URL couldn't be fetched, it resolved to a local address.");
						}

						const res = await fetch(url.href);

						if (!res.ok) {
							throw new Error("URL couldn't be fetched, error " + res.status);
						}
						const text = await res.text();
						preprompt = preprompt.replaceAll(match[0], text);
					} catch (e) {
						preprompt = preprompt.replaceAll(match[0], (e as Error).message);
					}
				}

				if (messagesForPrompt[0].from === "system") {
					messagesForPrompt[0].content = preprompt;
				}
			}

			// inject websearch result & optionally images into the messages
			const processedMessages = await preprocessMessages(
				messagesForPrompt,
				messageToWriteTo.webSearch,
				model.multimodal,
				convId
			);

			const previousText = messageToWriteTo.content;

			let hasError = false;

			let buffer = "";

			messageToWriteTo.updatedAt = new Date();

			try {
				const endpoint = await model.getEndpoint();
				for await (const output of await endpoint({
					messages: processedMessages,
					preprompt,
					continueMessage: isContinue,
					generateSettings: assistant?.generateSettings,
				})) {
					// if not generated_text is here it means the generation is not done
					if (!output.generated_text) {
						if (!output.token.special) {
							buffer += output.token.text;

							// send the first 5 chars
							// and leave the rest in the buffer
							if (buffer.length >= 5) {
								update({
									type: "stream",
									token: buffer.slice(0, 5),
								});
								buffer = buffer.slice(5);
							}

							// abort check
							const date = abortedGenerations.get(convId.toString());
							if (date && date > promptedAt) {
								break;
							}
							// no output check
							if (!output) {
								break;
							}

							// otherwise we just concatenate tokens
							messageToWriteTo.content += output.token.text;
						}
					} else {
						messageToWriteTo.interrupted =
							!output.token.special && !model.parameters.stop?.includes(output.token.text);
						// add output.generated text to the last message
						// strip end tokens from the output.generated_text
						const text = (model.parameters.stop ?? []).reduce((acc: string, curr: string) => {
							if (acc.endsWith(curr)) {
								messageToWriteTo.interrupted = false;
								return acc.slice(0, acc.length - curr.length);
							}
							return acc;
						}, output.generated_text.trimEnd());

						messageToWriteTo.content = previousText + text;
					}
				}
			} catch (e) {
				hasError = true;
				update({ type: "status", status: "error", message: (e as Error).message });
			} finally {
				// check if no output was generated
				if (!hasError && messageToWriteTo.content === previousText) {
					update({
						type: "status",
						status: "error",
						message: "No output was generated. Something went wrong.",
					});
				}

				if (buffer) {
					update({
						type: "stream",
						token: buffer,
					});
				}
			}

			await collections.conversations.updateOne(
				{
					_id: convId,
				},
				{
					$set: {
						messages: conv.messages,
						title: conv?.title,
						updatedAt: new Date(),
					},
				}
			);

			// used to detect if cancel() is called bc of interrupt or just because the connection closes
			doneStreaming = true;

			update({
				type: "finalAnswer",
				text: messageToWriteTo.content,
			});

			await summarizeIfNeeded;
			controller.close();
			return;
		},
		async cancel() {
			if (!doneStreaming) {
				await collections.conversations.updateOne(
					{
						_id: convId,
					},
					{
						$set: {
							messages: conv.messages,
							title: conv.title,
							updatedAt: new Date(),
						},
					}
				);
			}
		},
	});

	if (conv.assistantId) {
		await collections.assistantStats.updateOne(
			{ assistantId: conv.assistantId, "date.at": startOfHour(new Date()), "date.span": "hour" },
			{ $inc: { count: 1 } },
			{ upsert: true }
		);
	}

	// Todo: maybe we should wait for the message to be saved before ending the response - in case of errors
	return new Response(stream, {
		headers: {
			"Content-Type": "text/event-stream",
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
		throw error(404, "Conversation not found");
	}

	await collections.conversations.deleteOne({ _id: conv._id });

	return new Response();
}

export async function PATCH({ request, locals, params }) {
	const { title } = z
		.object({ title: z.string().trim().min(1).max(100) })
		.parse(await request.json());

	const convId = new ObjectId(params.id);

	const conv = await collections.conversations.findOne({
		_id: convId,
		...authCondition(locals),
	});

	if (!conv) {
		throw error(404, "Conversation not found");
	}

	await collections.conversations.updateOne(
		{
			_id: convId,
		},
		{
			$set: {
				title,
			},
		}
	);

	return new Response();
}
