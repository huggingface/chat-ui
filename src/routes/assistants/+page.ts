import { base } from "$app/paths";
import type { GETAssistantsSearchResponse } from "$api/routes/groups/assistants";
import { error } from "@sveltejs/kit";

export const load = async ({ url, fetch }) => {
	const r = await fetch(`${base}/api/v2/assistants/search?${url.searchParams.toString()}`);

	if (!r.ok) {
		throw error(r.status, "Failed to fetch assistants");
	}

	const data = (await r.json()) as GETAssistantsSearchResponse;

	return data;
};
