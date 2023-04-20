import { collections } from '$lib/server/database.js';
import { error } from '@sveltejs/kit';

export async function load({ params }) {
	const conversation = await collections.conversations.findOne({
		'shares.id': params.id
	});

	if (!conversation) {
		throw error(404, 'Conversation not found');
	}

	return {
		messages: conversation.messages
	};
}
