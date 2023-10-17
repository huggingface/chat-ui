import { HF_ACCESS_TOKEN, MESSAGES_BEFORE_LOGIN, RATE_LIMIT } from "$env/static/private";
import { buildPrompt } from "$lib/buildPrompt";
import { PUBLIC_SEP_TOKEN } from "$lib/constants/publicSepToken";
import { authCondition, requiresUser } from "$lib/server/auth";
import { collections } from "$lib/server/database";
import { modelEndpoint } from "$lib/server/modelEndpoint";
import { models } from "$lib/server/models";
import { ERROR_MESSAGES } from "$lib/stores/errors";
import type { Message } from "$lib/types/Message";
import { trimPrefix } from "$lib/utils/trimPrefix";
import { trimSuffix } from "$lib/utils/trimSuffix";
import { textGenerationStream } from "@huggingface/inference";
import { error } from "@sveltejs/kit";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { AwsClient } from "aws4fetch";
import type { MessageUpdate } from "$lib/types/MessageUpdate";
import { runWebSearch } from "$lib/server/websearch/runWebSearch";
import type { WebSearch } from "$lib/types/WebSearch";
import { abortedGenerations } from "$lib/server/abortedGenerations";
import { summarize } from "$lib/server/summarize";

export async function POST({ request, fetch, locals, params, getClientAddress }) {
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

	// make sure an anonymous user can't post more than one message
	if (
		!locals.user?._id &&
		requiresUser &&
		conv.messages.length > (MESSAGES_BEFORE_LOGIN ? parseInt(MESSAGES_BEFORE_LOGIN) : 0)
	) {
		throw error(429, "Exceeded number of messages before login");
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
	} = z
		.object({
			inputs: z.string().trim().min(1),
			id: z.optional(z.string().uuid()),
			response_id: z.optional(z.string().uuid()),
			is_retry: z.optional(z.boolean()),
			web_search: z.optional(z.boolean()),
		})
		.parse(json);

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
				{ content: newPrompt, from: "user", id: messageId as Message["id"], updatedAt: new Date() },
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

			// we can now build the prompt using the messages
			const prompt = await buildPrompt({
				messages,
				model,
				webSearch: webSearchResults,
				preprompt: conv.preprompt ?? model.preprompt,
				locals: locals,
			});

			// fetch the endpoint
			const randomEndpoint = modelEndpoint(model);

			let usedFetch = fetch;

			if (randomEndpoint.host === "sagemaker") {
				const aws = new AwsClient({
					accessKeyId: randomEndpoint.accessKey,
					secretAccessKey: randomEndpoint.secretKey,
					sessionToken: randomEndpoint.sessionToken,
					service: "sagemaker",
				});

				usedFetch = aws.fetch.bind(aws) as typeof fetch;
			}

			async function saveLast(generated_text: string) {
				if (!conv) {
					throw error(404, "Conversation not found");
				}

				const lastMessage = messages[messages.length - 1];

				if (lastMessage) {
					// We could also check if PUBLIC_ASSISTANT_MESSAGE_TOKEN is present and use it to slice the text
					if (generated_text.startsWith(prompt)) {
						generated_text = generated_text.slice(prompt.length);
					}

					generated_text = trimSuffix(
						trimPrefix(generated_text, "<|startoftext|>"),
						PUBLIC_SEP_TOKEN
					).trimEnd();

					// remove the stop tokens
					for (const stop of [...(model?.parameters?.stop ?? []), "<|endoftext|>"]) {
						if (generated_text.endsWith(stop)) {
							generated_text = generated_text.slice(0, -stop.length).trimEnd();
						}
					}
					lastMessage.content = generated_text;

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

					update({
						type: "finalAnswer",
						text: generated_text,
					});
				}
			}

			const tokenStream = textGenerationStream(
				{
					parameters: {
						...models.find((m) => m.id === conv.model)?.parameters,
						return_full_text: false,
					},
					model: randomEndpoint.url,
					inputs: prompt,
					accessToken: randomEndpoint.host === "sagemaker" ? undefined : HF_ACCESS_TOKEN,
				},
				{
					use_cache: false,
					fetch: usedFetch,
				}
			);

			for await (const output of tokenStream) {
				// if not generated_text is here it means the generation is not done
				if (!output.generated_text) {
					// else we get the next token
					if (!output.token.special) {
						const lastMessage = messages[messages.length - 1];
						update({
							type: "stream",
							token: output.token.text,
						});

						// if the last message is not from assistant, it means this is the first token
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
							const date = abortedGenerations.get(convId.toString());
							if (date && date > promptedAt) {
								saveLast(lastMessage.content);
							}
							if (!output) {
								break;
							}

							// otherwise we just concatenate tokens
							lastMessage.content += output.token.text;
						}
					}
				} else {
					saveLast(output.generated_text);
				}
			}
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
