import { env } from '$env/dynamic/private';
import { PUBLIC_MODEL_ENDPOINT } from '$env/static/public';
import { addMessage, getConversation } from '$lib/server/database';
import type { ApiMessage } from '$lib/Types';
import { mappingToMessages } from '$lib/utils/chat.js';

export async function POST({ request }) {
	const { conversation_id, message } = await request.json();

	try {
		const conversation = await getConversation(conversation_id);

		if (!conversation) {
			return new Response('Conversation not found', { status: 404 });
		}

		// addMessage(conversation, message);

		const messages = mappingToMessages(conversation.mapping as Record<string, ApiMessage>);

		return await fetch(PUBLIC_MODEL_ENDPOINT, {
			headers: {
				...request.headers,
				'Content-Type': 'application/json',
				Authorization: `Basic ${env.HF_TOKEN}`
			},
			method: 'POST',
			body: await request.text()
		});
	} catch (e) {
		console.error(e);
		return new Response('Error', {
			status: 500
		});
	}
}
