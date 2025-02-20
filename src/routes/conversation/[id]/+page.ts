import type { GETConversationResponse } from "$lib/server/api/routes/groups/conversations.js";
import { UrlDependency } from "$lib/types/UrlDependency";
import { useEdenFetch } from "$lib/utils/api.js";
import { error } from "@sveltejs/kit";
export const load = async ({ params, depends, fetch }) => {
	depends(UrlDependency.Conversation);

	const edenFetch = useEdenFetch({ fetch });

	const { data, error: e } = await edenFetch("/conversations/:id", {
		params: {
			id: params.id,
		},
	});

	if (e) {
		error(e.status, e.message);
	}

	return data as GETConversationResponse;
};
