import { buildPrompt } from "$lib/buildPrompt";
import { PUBLIC_SEP_TOKEN } from "$lib/constants/publicSepToken";
import { concatUint8Arrays } from "$lib/utils/concatUint8Arrays";
import { streamToAsyncIterable } from "$lib/utils/streamToAsyncIterable";
import { trimPrefix } from "$lib/utils/trimPrefix";
import { trimSuffix } from "$lib/utils/trimSuffix";
import { type TextGenerationStreamOutput, textGeneration } from "@huggingface/inference";
import { error, type RequestEvent } from "@sveltejs/kit";
import { ObjectId } from "mongodb";
import { abortedGenerations } from "./abortedGenerations";
import { collections } from "./database";
import { modelEndpoint } from "./modelEndpoint";
import type { Message } from "$lib/types/Message";
import { authCondition } from "./auth";
import { models } from "$lib/server/models";
import { z } from "zod";

export async function generateMessage(body: any, { request, locals, fetch, params }: RequestEvent) {
	const date = new Date();

	const convId = z.string().parse(params.id);

	const {
		inputs: newPrompt,
		stream: isStreaming,
		options: { id: retryMessageId },
	} = z
		.object({
			inputs: z.string().trim().min(1),
			stream: z.boolean().optional().default(false),
			options: z
				.object({
					id: z.optional(z.string().uuid()),
				})
				.optional()
				.default({}),
		})
		.parse(body);

	const conv = await collections.conversations.findOne({
		_id: new ObjectId(convId),
		...authCondition(locals),
	});

	if (!conv) {
		throw error(404, "Conversation not found");
	}

	const model = models.find((m) => m.id === conv.model);

	if (!model) {
		throw error(410, "Model not available anymore");
	}

	const parameters = {
		...model.parameters,
		return_full_text: false,
	};

	const messages = (() => {
		if (retryMessageId) {
			let retryMessageIdx = conv.messages.findIndex((message) => message.id === retryMessageId);
			if (retryMessageIdx === -1) {
				retryMessageIdx = conv.messages.length;
			}
			return [
				...conv.messages.slice(0, retryMessageIdx),
				{ content: newPrompt, from: "user", id: retryMessageId as Message["id"] },
			];
		}
		return [
			...conv.messages,
			{
				content: newPrompt,
				from: "user",
				id: (retryMessageId as Message["id"]) || crypto.randomUUID(),
			},
		];
	})() satisfies Message[];

	const prompt = buildPrompt(messages, model);

	const randomEndpoint = modelEndpoint(model);

	const abortController = new AbortController();

	async function saveMessage(message: string) {
		// We could also check if PUBLIC_ASSISTANT_MESSAGE_TOKEN is present and use it to slice the text
		if (message.startsWith(prompt)) {
			message = message.slice(prompt.length);
		}

		message = trimSuffix(trimPrefix(message, "<|startoftext|>"), PUBLIC_SEP_TOKEN).trimEnd();

		for (const stop of [...(model?.parameters?.stop ?? []), "<|endoftext|>"]) {
			if (message.endsWith(stop)) {
				message = message.slice(0, -stop.length).trimEnd();
			}
		}

		messages.push({ from: "assistant", content: message, id: crypto.randomUUID() });

		await collections.conversations.updateOne(
			{
				_id: new ObjectId(convId),
			},
			{
				$set: {
					messages,
					updatedAt: new Date(),
				},
			}
		);

		return messages;
	}

	async function saveStreamedMessage(generatingText: Promise<string>) {
		saveMessage(await generatingText);
	}

	let stream;

	if (isStreaming) {
		const resp = await fetch(randomEndpoint.url, {
			headers: {
				"Content-Type": request.headers.get("Content-Type") ?? "application/json",
				Authorization: randomEndpoint.authorization,
			},
			method: "POST",
			body: JSON.stringify({
				...body,
				parameters,
				inputs: prompt,
				stream: true,
				options: { use_cache: false },
			}),
			signal: abortController.signal,
		});

		if (!resp.body) {
			throw new Error("Response body is empty");
		}

		const [stream1, stream2] = resp.body.tee();

		stream = stream1;

		const generatedText = parseStreamedText(stream2, convId, date, abortController);

		saveStreamedMessage(generatedText).catch(console.error);

		// Todo: maybe we should wait for the message to be saved before ending the response - in case of errors
		return { stream, response: resp };
	} else {
		const generatedText = await textGeneration(
			{
				inputs: prompt,
				model: randomEndpoint.url,
				parameters,
			},
			{
				use_cache: false,
				// fetch wrapper to add authorization header
				fetch: (url, opt) =>
					fetch(url, {
						...opt,
						headers: {
							...opt?.headers,
							Authorization: randomEndpoint.authorization,
						},
					}),
			}
		);

		await saveMessage(generatedText.generated_text).catch(console.error);

		return { messages };
	}
}

export async function parseStreamedText(
	stream: ReadableStream,
	conversationId: string,
	promptedAt: Date,
	abortController: AbortController
): Promise<string> {
	const inputs: Uint8Array[] = [];

	for await (const input of streamToAsyncIterable(stream)) {
		inputs.push(input);

		const date = abortedGenerations.get(conversationId);

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
