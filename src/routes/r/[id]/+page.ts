import { redirect } from "@sveltejs/kit";
import { browser } from "$app/environment";
import { useAPIClient, handleResponse } from "$lib/APIClient";

export const load = async ({ params, url, fetch, parent }) => {
	const leafId = url.searchParams.get("leafId");

	// In SPA/Capacitor mode, we need to handle the share-to-conversation client-side
	if (browser) {
		const parentData = await parent();

		// If user is logged in, create conversation from share via API
		if (parentData.user) {
			try {
				const client = useAPIClient({ fetch, origin: url.origin });
				const result = await client.conversations["from-share"]
					.post({ shareId: params.id })
					.then(handleResponse);

				const conversationId = result.conversationId;
				throw redirect(
					302,
					`../conversation/${conversationId}?leafId=${leafId}&fromShare=${params.id}`
				);
			} catch (e) {
				// If it's a redirect, re-throw it
				if (e && typeof e === "object" && "status" in e && e.status === 302) {
					throw e;
				}
				// For other errors, redirect to the conversation view (might be a shared view)
				throw redirect(302, `../conversation/${params.id}?leafId=${leafId}`);
			}
		}

		// Not logged in, redirect to conversation view (shared read-only view)
		throw redirect(302, `../conversation/${params.id}?leafId=${leafId}`);
	}

	// In SSR mode, this won't be reached because +page.server.ts handles it
	// But for safety, redirect to conversation
	throw redirect(302, `../conversation/${params.id}?leafId=${leafId}`);
};
