import type { PageServerLoad } from './$types';
import { collections } from '$lib/server/database';
import type { Conversation } from '$lib/types/Conversation';

export const load: PageServerLoad = async () => {
	const { conversations } = collections;

	return {
		conversations: await conversations
			.find()
			.sort({ updatedAt: -1 })
			.project<Pick<Conversation, 'title' | '_id' | 'updatedAt' | 'createdAt'>>({
				title: 1,
				_id: 1,
				updatedAt: 1,
				createdAt: 1
			})
			.map((conv) => ({ id: conv._id.toString(), title: conv.title }))
			.toArray()
	};
};
