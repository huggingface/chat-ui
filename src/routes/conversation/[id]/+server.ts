import { HF_ACCESS_TOKEN, MESSAGES_BEFORE_LOGIN, RATE_LIMIT } from "$env/static/private";
import { buildPrompt } from "$lib/buildPrompt";
import { PUBLIC_SEP_TOKEN } from "$lib/constants/publicSepToken";
import { authCondition, requiresUser } from "$lib/server/auth";
import { collections } from "$lib/server/database";
import { modelEndpoint } from "$lib/server/modelEndpoint";
import { models } from "$lib/server/models";
import { ERROR_MESSAGES } from "$lib/stores/errors.js";
import type { Message } from "$lib/types/Message";
import { trimPrefix } from "$lib/utils/trimPrefix";
import { trimSuffix } from "$lib/utils/trimSuffix";
import { textGenerationStream, type TextGenerationStreamOutput } from "@huggingface/inference";
import { error } from "@sveltejs/kit";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { AwsClient } from "aws4fetch";
import type { MessageUpdate } from "$lib/types/MessageUpdate";
import { runWebSearch } from "$lib/server/websearch/runWebSearch";
import type { WebSearch } from "$lib/types/WebSearch";
import { streamToAsyncIterable } from "$lib/utils/streamToAsyncIterable";
import { abortedGenerations } from "$lib/server/abortedGenerations";
import { concatUint8Arrays } from "$lib/utils/concatUint8Arrays";
import { makeRequestOptions } from "$lib/server/getInit";

async function parseGeneratedText(
	stream: ReadableStream,
	conversationId: ObjectId,
	promptedAt: Date,
	abortController: AbortController
): Promise<string> {
	const inputs: Uint8Array[] = [];
	for await (const input of streamToAsyncIterable(stream)) {
		inputs.push(input);

		console.log(new TextDecoder().decode(concatUint8Arrays(inputs)));

		const date = abortedGenerations.get(conversationId.toString());

		if (date && date > promptedAt) {
			abortController.abort("Cancelled by user");
			const completeInput = concatUint8Arrays(inputs);

			const lines = new TextDecoder()
				.decode(completeInput)
				.split("\n")
				.filter((line) => line.startsWith("data:"));

			const tokens = lines.map((line) => {
				try {
					const json: TextGenerationStreamOutput = JSON.parse(line.slice("data:".length));
					return json.token.text;
				} catch {
					return "";
				}
			});
			return tokens.join("");
		}
	}

	// Merge inputs into a single Uint8Array
	const completeInput = concatUint8Arrays(inputs);

	// Get last line starting with "data:" and parse it as JSON to get the generated text
	const message = new TextDecoder().decode(completeInput);

	let lastIndex = message.lastIndexOf("\ndata:");
	if (lastIndex === -1) {
		lastIndex = message.indexOf("data");
	}

	if (lastIndex === -1) {
		console.error("Could not parse last message", message);
	}

	let lastMessage = message.slice(lastIndex).trim().slice("data:".length);
	if (lastMessage.includes("\n")) {
		lastMessage = lastMessage.slice(0, lastMessage.indexOf("\n"));
	}

	const lastMessageJSON = JSON.parse(lastMessage);

	if (lastMessageJSON.error) {
		throw new Error(lastMessageJSON.error);
	}

	const res = lastMessageJSON.generated_text;

	if (typeof res !== "string") {
		throw new Error("Could not parse generated text");
	}

	return res;
}

export async function POST({ request, fetch, locals, params, getClientAddress }) {
	const id = z.string().parse(params.id);
	const convId = new ObjectId(id);

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
	const settings = await collections.settings.findOne(authCondition(locals));

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

	// we now build the stream
	const stream = new ReadableStream({
		async start(controller) {
			const updates: MessageUpdate[] = [];

			function update(newUpdate: MessageUpdate) {
				updates.push(newUpdate);
				controller.enqueue(JSON.stringify(newUpdate) + "\n");
			}

			update({ type: "status", status: "started" });

			let webSearchResults: WebSearch | undefined;

			if (webSearch) {
				webSearchResults = await runWebSearch(conv, newPrompt, update);
				console.log(webSearchResults);
			}

			// we can now build the prompt using the messages
			const prompt = await buildPrompt({
				messages,
				model,
				webSearch: webSearchResults,
				preprompt: settings?.customPrompts?.[model.id] ?? model.preprompt,
				locals: locals,
			});

			// fetch the endpoint
			const randomEndpoint = modelEndpoint(model);

			// const abortController = new AbortController();
			// send the request either to aws or to the inference endpoint

			// const init = makeRequestOptions(
			// 	{
			// 		parameters: {
			// 			...models.find((m) => m.id === conv.model)?.parameters,
			// 			return_full_text: false,
			// 		},
			// 		model: conv.model,
			// 		inputs: newPrompt,
			// 	},
			// 	{
			// 		use_cache: false,
			// 	}
			// );

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

			const tokenStream = textGenerationStream(
				{
					parameters: {
						...models.find((m) => m.id === conv.model)?.parameters,
						return_full_text: false,
					},
					model: randomEndpoint.url,
					inputs: newPrompt,
					accessToken: randomEndpoint.host === "sagemaker" ? undefined : HF_ACCESS_TOKEN,
				},
				{
					use_cache: false,
					fetch: usedFetch,
				}
			);

			// ugly ts trick
			// https://github.com/microsoft/TypeScript/issues/29867#issuecomment-1519126346

			for await (const output of tokenStream) {
				if (!output) {
					console.log("breaking out");
					break;
				}

				// if not generated_text is here it means the generation is not done
				if (!output.generated_text) {
					// else we get the next token
					if (!output.token.special) {
						const lastMessage = messages[messages.length - 1];

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
							// otherwise we just concatenate tokens
							lastMessage.content += output.token.text;

							update({
								type: "stream",
								token: output.token.text,
							});
						}
					}
				} else {
					const lastMessage = messages[messages.length - 1];

					if (lastMessage) {
						let generated_text = output.generated_text;

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
									updatedAt: new Date(),
								},
							}
						);

						update({
							type: "finalAnswer",
							text: generated_text,
						});
					}
					break;
				}
			}
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
