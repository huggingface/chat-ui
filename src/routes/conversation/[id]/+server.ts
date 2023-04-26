import { PUBLIC_SEP_TOKEN } from "$env/static/public";
import { buildPrompt } from "$lib/buildPrompt.js";
import { collections } from "$lib/server/database.js";
import { modelEndpoint } from "$lib/server/modelEndpoint.js";
import type { Message } from "$lib/types/Message.js";
import { streamToAsyncIterable } from "$lib/utils/streamToAsyncIterable";
import { sum } from "$lib/utils/sum";
import { trimPrefix } from "$lib/utils/trimPrefix.js";
import { trimSuffix } from "$lib/utils/trimSuffix.js";
import { error } from "@sveltejs/kit";
import { ObjectId } from "mongodb";

export async function POST({ request, fetch, locals, params }) {
	// todo: add validation on params.id
	const convId = new ObjectId(params.id);

	const conv = await collections.conversations.findOne({
		_id: convId,
		sessionId: locals.sessionId,
	});

	if (!conv) {
		throw error(404, "Conversation not found");
	}

	// Todo: validate prompt with zod? or aktype
	const json = await request.json();

	const messages = [...conv.messages, { from: "user", content: json.inputs }] satisfies Message[];
	const prompt = buildPrompt(messages);

	const randomEndpoint = modelEndpoint();

	const resp = await fetch(randomEndpoint.endpoint, {
		headers: {
			"Content-Type": request.headers.get("Content-Type") ?? "application/json",
			Authorization: randomEndpoint.authorization,
		},
		method: "POST",
		body: JSON.stringify({
			...json,
			inputs: prompt,
		}),
	});

	const [stream1, stream2] = resp.body!.tee();

	async function saveMessage() {
		let generated_text = await parseGeneratedText(stream2);

		// We could also check if PUBLIC_ASSISTANT_MESSAGE_TOKEN is present and use it to slice the text
		if (generated_text.startsWith(prompt)) {
			generated_text = generated_text.slice(prompt.length);
		}

		generated_text = trimSuffix(trimPrefix(generated_text, "<|startoftext|>"), PUBLIC_SEP_TOKEN);

		messages.push({ from: "assistant", content: generated_text });

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
		sessionId: locals.sessionId,
	});

	if (!conv) {
		throw error(404, "Conversation not found");
	}

	await collections.conversations.deleteOne({ _id: conv._id });

	return new Response();
}

async function parseGeneratedText(stream: ReadableStream): Promise<string> {
	const inputs: Uint8Array[] = [];
	for await (const input of streamToAsyncIterable(stream)) {
		inputs.push(input);
	}

	// Merge inputs into a single Uint8Array
	const completeInput = new Uint8Array(sum(inputs.map((input) => input.length)));
	let offset = 0;
	for (const input of inputs) {
		completeInput.set(input, offset);
		offset += input.length;
	}

	// Get last line starting with "data:" and parse it as JSON to get the generated text
	const message = new TextDecoder().decode(completeInput);

	let lastIndex = message.lastIndexOf("\ndata:");
	if (lastIndex === -1) {
		lastIndex = message.indexOf("data");
	}

	if (lastIndex === -1) {
		console.error("Could not parse in last message");
	}

	let lastMessage = message.slice(lastIndex).trim().slice("data:".length);
	if (lastMessage.includes("\n")) {
		lastMessage = lastMessage.slice(0, lastMessage.indexOf("\n"));
	}

	const res = JSON.parse(lastMessage).generated_text;

	if (typeof res !== "string") {
		throw new Error("Could not parse generated text");
	}

	return res;
}
