import { MESSAGES_BEFORE_LOGIN, RATE_LIMIT } from "$env/static/private";
import { buildPrompt } from "$lib/buildPrompt";
import { PUBLIC_SEP_TOKEN } from "$lib/constants/publicSepToken";
import { abortedGenerations } from "$lib/server/abortedGenerations";
import { authCondition, requiresUser } from "$lib/server/auth";
import { collections } from "$lib/server/database";
import { modelEndpoint } from "$lib/server/modelEndpoint";
import { models } from "$lib/server/models";
import { ERROR_MESSAGES } from "$lib/stores/errors.js";
import type { Message } from "$lib/types/Message";
import { concatUint8Arrays } from "$lib/utils/concatUint8Arrays";
import { streamToAsyncIterable } from "$lib/utils/streamToAsyncIterable";
import { trimPrefix } from "$lib/utils/trimPrefix";
import { trimSuffix } from "$lib/utils/trimSuffix";
import type { TextGenerationStreamOutput } from "@huggingface/inference";
import { error } from "@sveltejs/kit";
import { ObjectId } from "mongodb";
import { z } from "zod";

export async function POST({ request, fetch, locals, params }) {
	const id = z.string().parse(params.id);
	const convId = new ObjectId(id);
	const date = new Date();

	const userId = locals.user?._id ?? locals.sessionId;

	if (!userId) {
		throw error(401, "Unauthorized");
	}

	const conv = await collections.conversations.findOne({
		_id: convId,
		...authCondition(locals),
	});

	if (!conv) {
		throw error(404, "Conversation not found");
	}

	if (
		!locals.user?._id &&
		requiresUser &&
		conv.messages.length > (MESSAGES_BEFORE_LOGIN ? parseInt(MESSAGES_BEFORE_LOGIN) : 0)
	) {
		throw error(429, "Exceeded number of messages before login");
	}

	const nEvents = await collections.messageEvents.countDocuments({ userId });

	if (RATE_LIMIT != "" && nEvents > parseInt(RATE_LIMIT)) {
		throw error(429, ERROR_MESSAGES.rateLimited);
	}

	const model = models.find((m) => m.id === conv.model);

	if (!model) {
		throw error(410, "Model not available anymore");
	}

	const json = await request.json();
	const {
		inputs: newPrompt,
		options: { id: messageId, is_retry, web_search_id, response_id: responseId },
	} = z
		.object({
			inputs: z.string().trim().min(1),
			options: z.object({
				id: z.optional(z.string().uuid()),
				response_id: z.optional(z.string().uuid()),
				is_retry: z.optional(z.boolean()),
				web_search_id: z.ostring(),
			}),
		})
		.parse(json);

	const messages = (() => {
		if (is_retry && messageId) {
			let retryMessageIdx = conv.messages.findIndex((message) => message.id === messageId);
			if (retryMessageIdx === -1) {
				retryMessageIdx = conv.messages.length;
			}
			return [
				...conv.messages.slice(0, retryMessageIdx),
				{ content: newPrompt, from: "user", id: messageId as Message["id"], updatedAt: new Date() },
			];
		}
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

	const prompt = await buildPrompt(messages, model, web_search_id);
	const randomEndpoint = modelEndpoint(model);

	const abortController = new AbortController();

	const resp = await fetch(randomEndpoint.url, {
		headers: {
			"Content-Type": request.headers.get("Content-Type") ?? "application/json",
			Authorization: randomEndpoint.authorization,
		},
		method: "POST",
		body: JSON.stringify({
			...json,
			inputs: prompt,
		}),
		signal: abortController.signal,
	});

	if (!resp.body) {
		throw new Error("Response body is empty");
	}

	const [stream1, stream2] = resp.body.tee();

	async function saveMessage() {
		let generated_text = await parseGeneratedText(stream2, convId, date, abortController);

		// We could also check if PUBLIC_ASSISTANT_MESSAGE_TOKEN is present and use it to slice the text
		if (generated_text.startsWith(prompt)) {
			generated_text = generated_text.slice(prompt.length);
		}

		generated_text = trimSuffix(
			trimPrefix(generated_text, "<|startoftext|>"),
			PUBLIC_SEP_TOKEN
		).trimEnd();

		for (const stop of [...(model?.parameters?.stop ?? []), "<|endoftext|>"]) {
			if (generated_text.endsWith(stop)) {
				generated_text = generated_text.slice(0, -stop.length).trimEnd();
			}
		}

		messages.push({
			from: "assistant",
			content: generated_text,
			webSearchId: web_search_id,
			id: (responseId as Message["id"]) || crypto.randomUUID(),
			createdAt: new Date(),
			updatedAt: new Date(),
		});

		await collections.messageEvents.insertOne({
			userId: userId,
			createdAt: new Date(),
		});

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
	}

	saveMessage().catch(console.error);
	// Todo: maybe we should wait for the message to be saved before ending the response - in case of errors
	return new Response(stream1, {
		headers: Object.fromEntries(resp.headers.entries()),
		status: resp.status,
		statusText: resp.statusText,
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

async function parseGeneratedText(
	stream: ReadableStream,
	conversationId: ObjectId,
	promptedAt: Date,
	abortController: AbortController
): Promise<string> {
	const inputs: Uint8Array[] = [];
	for await (const input of streamToAsyncIterable(stream)) {
		inputs.push(input);

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
