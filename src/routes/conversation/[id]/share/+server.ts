import { collections } from '$lib/server/database.js';
import { error } from '@sveltejs/kit';
import { ObjectId } from 'mongodb';
import { nanoid } from 'nanoid';

export async function POST({ params, url, locals }) {
	const conversation = await collections.conversations.findOne({
		_id: new ObjectId(params.id),
		sessionId: locals.sessionId
	});

	if (!conversation) {
		throw error(404, 'Conversation not found');
	}

	const shares = conversation.shares || [];

	const existingShare = shares.find((share) => share.msgCount === conversation.messages.length);

	if (existingShare) {
		return new Response(
			JSON.stringify({
				url: url.origin + `/r/${existingShare.id}`
			}),
			{ headers: { 'Content-Type': 'application/json' } }
		);
	}

	const share = {
		id: nanoid(7),
		msgCount: conversation.messages.length
	};

	await collections.conversations.updateOne(
		{
			_id: conversation._id
		},
		{
			$set: {
				shares: [...shares, share],
				updatedAt: new Date()
			}
		}
	);

	return new Response(
		JSON.stringify({
			url: url.origin.replace('huggingface.co', 'hf.co') + `/r/${share.id}`
		}),
		{ headers: { 'Content-Type': 'application/json' } }
	);
}
