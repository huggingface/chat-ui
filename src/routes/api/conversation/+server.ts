import { HfInference } from '@huggingface/inference';
import {
	PUBLIC_HF_TOKEN,
	PUBLIC_ASSISTANT_MESSAGE_TOKEN,
	PUBLIC_SEP_TOKEN,
	PUBLIC_USER_MESSAGE_TOKEN,
	PUBLIC_ENDPOINT
} from '$env/static/public';
import { addMessage, getConversation } from '$lib/server/database';
import type { ApiMessage, Message } from '$lib/Types';
import { mappingToMessages } from '$lib/utils/chat.js';
const userToken = PUBLIC_USER_MESSAGE_TOKEN || '<|prompter|>';
const assistantToken = PUBLIC_ASSISTANT_MESSAGE_TOKEN || '<|assistant|>';
const sepToken = PUBLIC_SEP_TOKEN || '<|endoftext|>';

const hf = new HfInference(
	undefined,
	{
		headers: {
			Authorization: `Basic ${PUBLIC_HF_TOKEN}`
		}
	},
	PUBLIC_ENDPOINT
);

function messageToInputs(messages: Message[], newMessage: string) {
	const inputs =
		[...messages, { from: 'user', content: newMessage }]
			.map(
				(m) =>
					(m.from === 'user' ? userToken + m.content : assistantToken + m.content) +
					(m.content.endsWith(sepToken) ? '' : sepToken)
			)
			.join('') + assistantToken;

	return inputs;
}

export async function POST({ request }) {
	const { conversation_id, message } = await request.json();
	let hfRes: any;

	try {
		const conversation = await getConversation(conversation_id);

		if (!conversation) {
			return new Response('Conversation not found', { status: 404 });
		}

		// addMessage(conversation, message);

		const messages = mappingToMessages(conversation.mapping as Record<string, ApiMessage>);

		hfRes = hf.textGenerationStream(
			{
				inputs: messageToInputs(messages, message),
				parameters: {
					max_new_tokens: 250,
					// @ts-ignore
					stop_sequences: ['<|endoftext|>'],
					truncate: 1024
					// do_sample: false,
					// return_full_text: false,
					// typical_p: 0.2,
					// watermark: false,
					// details: true
				}
			},
			{
				use_cache: false
			}
		);
	} catch (e) {
		console.error(e);
		return new Response('Error', {
			status: 500
		});
	}

	let botMessage = '';

	const stream = new ReadableStream({
		async pull(controller) {
			const { value, done } = await hfRes.next();
			if (done) {
				controller.close();
				addMessage(conversation_id, botMessage);
			} else {
				controller.enqueue(JSON.stringify(value));
				botMessage += value.generated_text;
			}
		},
		async cancel() {
			addMessage(conversation_id, botMessage);
		}
	});

	return new Response(stream, {
		headers: {
			'content-type': 'text/event-stream'
		}
	});
}
