import { HF_TOKEN } from "$env/static/private";
import { PUBLIC_MODEL_ENDPOINT } from "$env/static/public";
import { buildPrompt } from "$lib/buildPrompt.js";
import { collections } from "$lib/server/database.js";
import type { Message } from "$lib/types/Message.js";
import { streamToAsyncIterable } from "$lib/utils/streamToAsyncIterable";
import { sum } from "$lib/utils/sum";
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

	const resp = await fetch(PUBLIC_MODEL_ENDPOINT, {
		headers: {
			"Content-Type": request.headers.get("Content-Type") ?? "application/json",
			Authorization: `Basic ${HF_TOKEN}`,
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

	if (conv.shares?.length) {
		// Keep the convo, as it's been shared we don't want to invalidate share links
		await collections.conversations.updateOne({ _id: conv._id }, { $unset: { sessionId: 1 } });
	} else {
		await collections.conversations.deleteOne({ _id: conv._id });
	}

	return new Response();
}

export async function PATCH({ request, locals, params }) {
	const convId = new ObjectId(params.id);
	const json = (await request.json()) as { messages: string[] };

	const userPrompt =
		`You are a summarizing assistant. Please summarize the following messages as a single sentence between 3 and 10 words:\n` +
		json.messages.join("\n");

	const prompt = buildPrompt([{ from: "user", content: userPrompt }]);

	const resp = await fetch(PUBLIC_MODEL_ENDPOINT, {
		headers: {
			"Content-Type": "application/json",
			Authorization: `Basic ${HF_TOKEN}`,
		},
		method: "POST",
		body: JSON.stringify({
			inputs: prompt,
			parameters: {
				temperature: 0.9,
				top_p: 0.95,
				repetition_penalty: 1.2,
				top_k: 50,
				watermark: false,
				max_new_tokens: 1024,
				stop: ["<|endoftext|>"],
				return_full_text: false,
			},
		}),
	});

	const response = await resp.json();
	let generatedTitle: string | undefined;
	try {
		if (typeof response[0].generated_text === "string") {
			generatedTitle = response[0].generated_text;
		}
	} catch {
		console.error("summarization failed");
	}

	if (generatedTitle) {
		await collections.conversations.updateOne(
			{
				_id: convId,
				sessionId: locals.sessionId,
			},
			{
				$set: { title: generatedTitle },
			}
		);
	}

	return new Response(
		JSON.stringify(
			generatedTitle
				? {
						title: generatedTitle,
				  }
				: {}
		),
		{ headers: { "Content-Type": "application/json" } }
	);
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
