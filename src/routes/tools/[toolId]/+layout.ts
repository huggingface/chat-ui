import { base } from "$app/paths";
import type { ReviewStatus } from "$lib/types/Review";
import type { Tool } from "$lib/types/Tool.js";
import type { Serialize } from "$lib/utils/serialize";
import { error } from "@sveltejs/kit";

export const load = async ({ params, fetch }) => {
	const r = await fetch(`${base}/api/v2/tools/${params.toolId}`);

	if (!r.ok) {
		throw error(r.status, r.statusText);
	}

	const data = await r.json();

	return {
		tool: data as Serialize<
			Tool & {
				createdById: string | null;
				createdByMe: boolean;
				reported: boolean;
				review: ReviewStatus;
			}
		>,
	};
};
