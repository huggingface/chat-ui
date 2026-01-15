import { redirect, isRedirect } from "@sveltejs/kit";
import { browser } from "$app/environment";
import { useAPIClient, handleResponse } from "$lib/APIClient";

// Validate shareId format (7 alphanumeric characters)
const isValidShareId = (id: string): boolean => /^[a-zA-Z0-9]{7}$/.test(id);

export const load = async ({ params, url, fetch, parent }) => {
	const leafId = url.searchParams.get("leafId");
	const leafIdParam = leafId ? `?leafId=${leafId}` : "";

	// In SPA/Capacitor mode, we need to handle the share-to-conversation client-side
	if (browser) {
		// Validate shareId before making API calls
		if (!isValidShareId(params.id)) {
			throw redirect(302, `../conversation/${params.id}${leafIdParam}`);
		}

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
				// Re-throw SvelteKit redirects
				if (isRedirect(e)) {
					throw e;
				}
				// For API errors, fall back to shared read-only view
				console.error("Failed to create conversation from share:", e);
				throw redirect(302, `../conversation/${params.id}${leafIdParam}`);
			}
		}

		// Not logged in, redirect to conversation view (shared read-only view)
		throw redirect(302, `../conversation/${params.id}${leafIdParam}`);
	}

	// In SSR mode, this won't be reached because +page.server.ts handles it
	// But for safety, redirect to conversation
	throw redirect(302, `../conversation/${params.id}${leafIdParam}`);
};
