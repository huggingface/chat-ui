import { base } from "$app/paths";
import type { GETConversationResponse } from "$api/routes/groups/conversations";
import { UrlDependency } from "$lib/types/UrlDependency";
import { fetchJSON } from "$lib/utils/fetchJSON.js";
import { redirect } from "@sveltejs/kit";

export const load = async ({ params, depends, fetch }) => {
	depends(UrlDependency.Conversation);

	try {
		return await fetchJSON<GETConversationResponse>(`${base}/api/v2/conversations/${params.id}`, {
			fetch,
		});
	} catch {
		redirect(302, "/");
	}
};
