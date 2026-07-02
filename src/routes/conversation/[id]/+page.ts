import { useAPIClient, handleResponse } from "$lib/APIClient";
import { UrlDependency } from "$lib/types/UrlDependency";
import { redirect } from "@sveltejs/kit";
import { base } from "$app/paths";
import { browser } from "$app/environment";
import { safeInvalidate } from "$lib/utils/safeInvalidate";
import type { PageLoad } from "./$types";
import {
	CONVERSATION_CACHE_FRESH_MS,
	conversationFingerprint,
	getCachedConversation,
	invalidateCachedConversation,
	setCachedConversation,
	type ConversationData,
} from "$lib/utils/conversationCache";

// Id of the conversation the previous load() call served. A repeat load for
// the same id means invalidate(UrlDependency.Conversation) ran (stream
// finished, model switch, background poller) and fresh data is expected; only
// a load for a different id is a navigation that may be served from cache.
let lastLoadedId: string | undefined;

async function fetchConversation(
	client: ReturnType<typeof useAPIClient>,
	id: string,
	fromShare: string | undefined
): Promise<ConversationData> {
	return (await client
		.conversations({ id })
		.get({ query: { fromShare } })
		.then(handleResponse)) as ConversationData;
}

// Serve-stale-then-revalidate: fetch fresh data off the critical path and, if
// it differs from what the cache (and thus the page) currently shows, refresh
// the cache and re-run the load — which then hits the updated, fresh entry.
function revalidateInBackground(
	client: ReturnType<typeof useAPIClient>,
	id: string,
	fromShare: string | undefined,
	served: ConversationData
) {
	void fetchConversation(client, id, fromShare)
		.then((fresh) => {
			if (conversationFingerprint(fresh) === conversationFingerprint(served)) return;
			setCachedConversation(id, fresh);
			// safeInvalidate, not invalidate: a raw invalidate() fired from this
			// background task can cancel an in-flight navigation the user just
			// started (see safeInvalidate.ts).
			return safeInvalidate(UrlDependency.Conversation);
		})
		.catch(() => {
			// Could be a transient network failure just as well as a deleted or
			// inaccessible conversation — we cannot tell them apart here. Only
			// drop the cache entry; the next real navigation refetches and takes
			// the genuine error path. Forcing a reload here would bounce the user
			// to the homepage on a mere network blip.
			invalidateCachedConversation(id);
		});
}

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
	const isNavigation = lastLoadedId !== params.id;
	lastLoadedId = params.id;

	// Share views bypass the cache entirely: their payload depends on the
	// fromShare parameter, not just the conversation id.
	if (browser && isNavigation && !fromShare) {
		const cached = getCachedConversation(params.id);
		if (cached) {
			if (Date.now() - cached.fetchedAt > CONVERSATION_CACHE_FRESH_MS) {
				revalidateInBackground(client, params.id, fromShare, cached.data);
			}
			return cached.data;
		}
	}

	// Load conversation (works for both owned and shared conversations)
	try {
		const data = await fetchConversation(client, params.id, fromShare);
		if (browser && !fromShare) {
			setCachedConversation(params.id, data);
		}
		return data;
	} catch {
		redirect(302, `${base}/`);
	}
};
