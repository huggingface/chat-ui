import { useAPIClient, handleResponse } from "$lib/APIClient";
import { UrlDependency } from "$lib/types/UrlDependency";
import { redirect } from "@sveltejs/kit";
import { base } from "$app/paths";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ params, depends, fetch, url, parent }) => {
	depends(UrlDependency.Conversation);

	const client = useAPIClient({ fetch, origin: url.origin });

	// Handle share import for logged-in users (7-char IDs are share IDs)
	if (params.id.length === 7) {
		const parentData = await parent();

		if (parentData.loginEnabled && parentData.user) {
			const leafId = url.searchParams.get("leafId");

			try {
				const result = await client.conversations["import-share"]
					.post({ shareId: params.id })
					.then(handleResponse);

				redirect(
					302,
					`${base}/conversation/${result.conversationId}?leafId=${leafId ?? ""}&fromShare=${params.id}`
				);
			} catch {
				// Import failed, continue to load shared conversation for viewing
			}
		}
	}

	// Load conversation (works for both owned and shared conversations)
	try {
		return await client
			.conversations({ id: params.id })
			.get({ query: { fromShare: url.searchParams.get("fromShare") ?? undefined } })
			.then(handleResponse);
	} catch {
		redirect(302, `${base}/`);
	}
};
