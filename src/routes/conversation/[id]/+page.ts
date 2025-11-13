import { UrlDependency } from "$lib/types/UrlDependency";
import { redirect } from "@sveltejs/kit";
import { browser } from "$app/environment";
import { getConversation } from "$lib/storage/conversations";

export const load = async ({ params, depends }) => {
	depends(UrlDependency.Conversation);

	// Load conversation from IndexedDB on client-side
	// Server-side load returns empty data, actual loading happens in +page.svelte
	if (browser) {
		try {
			const conv = await getConversation(params.id);
			if (conv) {
				return {
					messages: conv.messages,
					title: conv.title,
					model: conv.model,
					preprompt: conv.preprompt,
					rootMessageId: conv.rootMessageId,
					id: conv.id,
					updatedAt: conv.updatedAt,
					modelId: conv.model,
					shared: false,
				};
			}
		} catch (err) {
			console.error("Failed to load conversation:", err);
		}
	}

	// Return empty data - will be loaded client-side
	return {
		messages: [],
		title: "",
		model: "",
		preprompt: undefined,
		rootMessageId: undefined,
		id: params.id,
		updatedAt: new Date(),
		modelId: "",
		shared: false,
	};
};
