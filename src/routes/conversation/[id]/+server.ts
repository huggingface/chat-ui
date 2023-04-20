import { HF_TOKEN } from '$env/static/private';
import { PUBLIC_MODEL_ENDPOINT } from '$env/static/public';
import { buildPrompt } from '$lib/buildPrompt.js';
import { collections } from '$lib/server/database.js';
import type { Message } from '$lib/types/Message.js';
import { streamToAsyncIterable } from '$lib/utils/streamToAsyncIterable';
import { sum } from '$lib/utils/sum';
import { error } from '@sveltejs/kit';
import { ObjectId } from 'mongodb';

export async function POST({ request, fetch, locals, params }) {
	// todo: add validation on params.id
	const convId = new ObjectId(params.id);

	const conv = await collections.conversations.findOne({
		_id: convId,
		sessionId: locals.sessionId
	});

	if (!conv) {
		throw error(404, 'Conversation not found');
	}

	// Todo: validate prompt with zod? or aktype
	const json = await request.json();

	const messages = [...conv.messages, { from: 'user', content: json.inputs }] satisfies Message[];

	json.inputs = buildPrompt(messages);

	const resp = await fetch(PUBLIC_MODEL_ENDPOINT, {
		headers: {
			'Content-Type': request.headers.get('Content-Type') ?? 'application/json',
			Authorization: `Basic ${HF_TOKEN}`
		},
		method: 'POST',
		body: JSON.stringify(json)
	});

	const [stream1, stream2] = resp.body!.tee();

	async function saveMessage() {
		const generated_text = await parseGeneratedText(stream2);

		messages.push({ from: 'assistant', content: generated_text });

		await collections.conversations.updateOne(
			{
				_id: convId
			},
			{
				$set: {
					messages,
					updatedAt: new Date()
				}
			}
		);
	}

	saveMessage().catch(console.error);

	// Todo: maybe we should wait for the message to be saved before ending the response - in case of errors
	return new Response(stream1, {
		headers: Object.fromEntries(resp.headers.entries()),
		status: resp.status,
		statusText: resp.statusText
	});
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

	let lastIndex = message.lastIndexOf('\ndata:');
	if (lastIndex === -1) {
		lastIndex = message.indexOf('data');
	}

	if (lastIndex === -1) {
		console.error('Could not parse in last message');
	}

	let lastMessage = message.slice(lastIndex).trim().slice('data:'.length);
	if (lastMessage.includes('\n')) {
		lastMessage = lastMessage.slice(0, lastMessage.indexOf('\n'));
	}

	const res = JSON.parse(lastMessage).generated_text;

	if (typeof res !== 'string') {
		throw new Error('Could not parse generated text');
	}

	return res;
}
