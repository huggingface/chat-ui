import { useAPIClient, handleResponse } from "$lib/APIClient";
import { UrlDependency } from "$lib/types/UrlDependency";
import { redirect } from "@sveltejs/kit";
import { base } from "$app/paths";
import { browser } from "$app/environment";
import type { PageLoad } from "./$types";
import { takePendingConversation, type ConversationData } from "$lib/utils/pendingConversation";

export const load: PageLoad = async ({ params, depends, fetch, url, parent }) => {
	depends(UrlDependency.Conversation);

	const client = useAPIClient({ fetch, origin: url.origin });

	// Handle share import for logged-in users (7-char IDs are share IDs)
	if (params.id.length === 7) {
		const parentData = await parent();

		if (parentData.loginEnabled && parentData.user) {
			const leafId = url.searchParams.get("leafId");

			let importedConversationId: string | undefined;
			try {
				const result = await client.conversations["import-share"]
					.post({ shareId: params.id })
					.then(handleResponse);
				importedConversationId = result.conversationId;
			} catch {
				// Import failed, continue to load shared conversation for viewing
			}

			if (importedConversationId) {
				redirect(
					302,
					`${base}/conversation/${importedConversationId}?leafId=${leafId ?? ""}&fromShare=${params.id}`
				);
			}
		}
	}

	const fromShare = url.searchParams.get("fromShare") ?? undefined;

	// A conversation created by this tab hands its payload over via a one-shot
	// seed (see pendingConversation.ts), consumed here so the first load after
	// create skips the network round trip. Every other load, including every
	// invalidate() re-run, fetches fresh data.
	if (browser && !fromShare) {
		const seeded = takePendingConversation(params.id);
		if (seeded) {
			return seeded;
		}
	}

	// Load conversation (works for both owned and shared conversations)
	try {
		return (await client
			.conversations({ id: params.id })
			.get({ query: { fromShare } })
			.then(handleResponse)) as ConversationData;
	} catch {
		redirect(302, `${base}/`);
	}
};
