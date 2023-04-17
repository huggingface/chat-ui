import { HfInference } from '@huggingface/inference';
import {
	PUBLIC_HF_TOKEN,
	PUBLIC_ASSISTANT_MESSAGE_TOKEN,
	PUBLIC_SEP_TOKEN,
	PUBLIC_USER_MESSAGE_TOKEN,
	PUBLIC_ENDPOINT
} from '$env/static/public';
import { db } from '$lib/dbClient';
import type { ApiMessage, Conversation } from '$lib/Types';
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

async function addMessage(conversation: Conversation, message: string) {
	await db
		.collection('conversations')
		.updateOne(
			{ _id: conversation.id },
			{ $set: { messages: [...conversation.messages, message] } }
		);
}

function messageToInputs(messages: ApiMessage[], newMessage: string) {
	const inputs =
		[...messages.map((m) => m.message), { from: 'user', content: newMessage }]
			.map(
				(m) =>
					(m.from === 'user' ? userToken + m.content : assistantToken + m.content) +
					(m.content.endsWith(sepToken) ? '' : sepToken)
			)
			.join('') + assistantToken;

	return inputs;
}

export async function POST({ request }) {
	const { conversation_id, message, parent_message_id } = await request.json();
	let hfRes: any;

	try {
		// const conversation = await db.collection('conversations').findOne({ _id: conversation_id });
		const conversation: { messages: ApiMessage[] } = { messages: [] };

		if (!conversation) {
			return new Response('Conversation not found', { status: 404 });
		}

		if (parent_message_id) {
			// const parent_message = conversation.messages.find((m) => m._id == parent_message_id);
			// if (!parent_message) {
			// 	return new Response('Parent message not found', { status: 404 });
			// }
			// if (!parent_message.replies) {
			// 	parent_message.replies = [];
			// }
			// parent_message.replies.push(message);
		} else {
			conversation.messages.push(message);
		}

		// addMessage(conversation, message);

		hfRes = hf.textGenerationStream(
			{
				inputs: messageToInputs(conversation.messages, message),
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
