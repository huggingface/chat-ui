import { base } from "$app/paths";
import type { GETConversationResponse } from "$lib/server/api/routes/groups/conversations.js";
import { UrlDependency } from "$lib/types/UrlDependency";
import { error } from "@sveltejs/kit";

export const load = async ({ params, depends, fetch }) => {
	depends(UrlDependency.Conversation);

	const r = await fetch(`${base}/api/v2/conversations/${params.id}`);

	if (!r.ok) {
		console.log({ r });
		error(r.status, "Failed to fetch conversation");
	}

	const data = await r.json();

	return data as GETConversationResponse;
};
