import { MESSAGES_BEFORE_LOGIN, RATE_LIMIT } from "$env/static/private";
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
import type { WebSearch } from "$lib/types/WebSearch";
import { abortedGenerations } from "$lib/server/abortedGenerations";
import { summarize } from "$lib/server/summarize";
import { uploadFile } from "$lib/server/files/uploadFile.js";
import sizeof from "image-size";

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
	const conv = await collections.conversations.findOne({
		_id: convId,
		...authCondition(locals),
	});

	if (!conv) {
		throw error(404, "Conversation not found");
	}

	// register the event for ratelimiting
	await collections.messageEvents.insertOne({
		userId: userId,
		createdAt: new Date(),
		ip: getClientAddress(),
	});

	// guest mode check
	if (
		!locals.user?._id &&
		requiresUser &&
		(MESSAGES_BEFORE_LOGIN ? parseInt(MESSAGES_BEFORE_LOGIN) : 0) > 0
	) {
		const totalMessages =
			(
				await collections.conversations
					.aggregate([
						{ $match: authCondition(locals) },
						{ $project: { messages: 1 } },
						{ $unwind: "$messages" },
						{ $match: { "messages.from": "assistant" } },
						{ $count: "messages" },
					])
					.toArray()
			)[0]?.messages ?? 0;

		if (totalMessages > parseInt(MESSAGES_BEFORE_LOGIN)) {
			throw error(429, "Exceeded number of messages before login");
		}
	}

	// check if the user is rate limited
	const nEvents = Math.max(
		await collections.messageEvents.countDocuments({ userId }),
		await collections.messageEvents.countDocuments({ ip: getClientAddress() })
	);

	if (RATE_LIMIT != "" && nEvents > parseInt(RATE_LIMIT)) {
		throw error(429, ERROR_MESSAGES.rateLimited);
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
		response_id: responseId,
		id: messageId,
		is_retry,
		web_search: webSearch,
		files: b64files,
	} = z
		.object({
			inputs: z.string().trim().min(1),
			id: z.optional(z.string().uuid()),
			response_id: z.optional(z.string().uuid()),
			is_retry: z.optional(z.boolean()),
			web_search: z.optional(z.boolean()),
			files: z.optional(z.array(z.string())),
		})
		.parse(json);

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

	// get the list of messages
	// while checking for retries
	let messages = (() => {
		if (is_retry && messageId) {
			// if the message is a retry, replace the message and remove the messages after it
			let retryMessageIdx = conv.messages.findIndex((message) => message.id === messageId);
			if (retryMessageIdx === -1) {
				retryMessageIdx = conv.messages.length;
			}
			return [
				...conv.messages.slice(0, retryMessageIdx),
				{
					content: newPrompt,
					from: "user",
					id: messageId as Message["id"],
					updatedAt: new Date(),
					files: conv.messages[retryMessageIdx]?.files,
				},
			];
		} // else append the message at the bottom

		return [
			...conv.messages,
			{
				content: newPrompt,
				from: "user",
				id: (messageId as Message["id"]) || crypto.randomUUID(),
				createdAt: new Date(),
				updatedAt: new Date(),
				files: hashes,
			},
		];
	})() satisfies Message[];

	await collections.conversations.updateOne(
		{
			_id: convId,
		},
		{
			$set: {
				messages,
				title: conv.title,
				updatedAt: new Date(),
			},
		}
	);

	// we now build the stream
	const stream = new ReadableStream({
		async start(controller) {
			const updates: MessageUpdate[] = [];

			function update(newUpdate: MessageUpdate) {
				if (newUpdate.type !== "stream") {
					updates.push(newUpdate);
				}
				controller.enqueue(JSON.stringify(newUpdate) + "\n");
			}

			update({ type: "status", status: "started" });

			if (conv.title === "New Chat" && messages.length === 1) {
				try {
					conv.title = (await summarize(newPrompt)) ?? conv.title;
					update({ type: "status", status: "title", message: conv.title });
				} catch (e) {
					console.error(e);
				}
			}

			await collections.conversations.updateOne(
				{
					_id: convId,
				},
				{
					$set: {
						messages,
						title: conv.title,
						updatedAt: new Date(),
					},
				}
			);

			let webSearchResults: WebSearch | undefined;

			if (webSearch) {
				webSearchResults = await runWebSearch(conv, newPrompt, update);
			}

			messages[messages.length - 1].webSearch = webSearchResults;

			conv.messages = messages;

			try {
				const endpoint = await model.getEndpoint();
				for await (const output of await endpoint({ conversation: conv })) {
					// if not generated_text is here it means the generation is not done
					if (!output.generated_text) {
						// else we get the next token
						if (!output.token.special) {
							update({
								type: "stream",
								token: output.token.text,
							});

							// if the last message is not from assistant, it means this is the first token
							const lastMessage = messages[messages.length - 1];

							if (lastMessage?.from !== "assistant") {
								// so we create a new message
								messages = [
									...messages,
									// id doesn't match the backend id but it's not important for assistant messages
									// First token has a space at the beginning, trim it
									{
										from: "assistant",
										content: output.token.text.trimStart(),
										webSearch: webSearchResults,
										updates: updates,
										id: (responseId as Message["id"]) || crypto.randomUUID(),
										createdAt: new Date(),
										updatedAt: new Date(),
									},
								];
							} else {
								// abort check
								const date = abortedGenerations.get(convId.toString());
								if (date && date > promptedAt) {
									break;
								}

								if (!output) {
									break;
								}

								// otherwise we just concatenate tokens
								lastMessage.content += output.token.text;
							}
						}
					} else {
						// add output.generated text to the last message
						messages = [
							...messages.slice(0, -1),
							{
								...messages[messages.length - 1],
								content: output.generated_text,
								updates: updates,
								updatedAt: new Date(),
							},
						];
					}
				}
			} catch (e) {
				console.error(e);
				update({ type: "status", status: "error", message: (e as Error).message });
			}
			await collections.conversations.updateOne(
				{
					_id: convId,
				},
				{
					$set: {
						messages,
						title: conv?.title,
						updatedAt: new Date(),
					},
				}
			);

			update({
				type: "finalAnswer",
				text: messages[messages.length - 1].content,
			});

			return;
		},
		async cancel() {
			await collections.conversations.updateOne(
				{
					_id: convId,
				},
				{
					$set: {
						messages,
						title: conv.title,
						updatedAt: new Date(),
					},
				}
			);
		},
	});

	// Todo: maybe we should wait for the message to be saved before ending the response - in case of errors
	return new Response(stream);
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
