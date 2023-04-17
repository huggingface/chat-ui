import type { Conversation } from '$lib/Types';

export async function GET({ request }) {
	const module = await import('../../../data/conversations.json');
	const conversations = JSON.stringify(module.default);

	return new Response(conversations);
}
