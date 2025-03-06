import { base } from "$app/paths";
import type { GETToolsSearchResponse } from "$api/routes/groups/tools";
import { error } from "@sveltejs/kit";

export const load = async ({ url, fetch }) => {
	const r = await fetch(`${base}/api/v2/tools/search?${url.searchParams.toString()}`);

	if (!r.ok) {
		throw error(r.status, "Failed to fetch tools");
	}

	const data = (await r.json()) as GETToolsSearchResponse;

	return data;
};
