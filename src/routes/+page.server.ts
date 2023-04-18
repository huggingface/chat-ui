import { mappingToMessages } from '$lib/utils/chat';
import type { PageServerLoad } from './$types';

export const load = (async ({ fetch, parent, url }) => {
	let conversation = null;
	const conversationId = url.searchParams.get('id');

	const parentData = await parent();

	if (!parentData.session)
		return {
			conversations: { items: [] }
		};

	if (conversationId) {
		const response = await fetch(`/api/conversation/${conversationId}`);
		const data = await response.json();

		conversation = {
			id: conversationId,
			title: data.title,
			messages: mappingToMessages(data.mapping)
		};
	}

	const response = await fetch('/api/conversations');

	const conversations = await response.json();

	return { conversations, conversation };
}) satisfies PageServerLoad;
