import { browser } from "$app/environment";
import { useAPIClient, handleResponse } from "$lib/APIClient";
import { UrlDependency } from "$lib/types/UrlDependency";
import { redirect } from "@sveltejs/kit";
import { base } from "$app/paths";
import type { PageLoad } from "./$types";
import type { Message } from "$lib/types/Message";
import type { DeployedSpace } from "$lib/types/Conversation";
import { conversationRepository } from "$lib/repositories/ConversationRepository";
import superjson from "superjson";

interface ConversationData {
	messages: Message[];
	title: string;
	model: string;
	preprompt?: string;
	rootMessageId?: string;
	id: string;
	updatedAt: Date;
	modelId: string;
	shared: boolean;
	deployedSpaces?: Record<string, DeployedSpace>;
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

	// Cache-aside: try server first, fall back to IndexedDB only on offline/network
	// failures. A definitive server response (403/404/etc.) must be honored — we
	// must not render a deleted or now-forbidden conversation from local cache.
	const response = await client
		.conversations({ id: params.id })
		.get({ query: { fromShare: url.searchParams.get("fromShare") ?? undefined } })
		.catch((fetchErr) => {
			// The fetch itself threw (true network failure, e.g. offline with no SW).
			console.error("[conversation] network request threw for", params.id, fetchErr);
			return undefined;
		});

	// Treat a thrown fetch and the service worker's 503 (or status 0) as "offline".
	// Any other error status is a definitive answer from the server.
	const isOffline = !response || response.status === 503 || response.status === 0;

	if (response && !isOffline) {
		// A definitive server error (deleted / forbidden / etc.) — honor it and
		// redirect home rather than serving a stale or private copy from cache.
		if (response.error) {
			console.error("[conversation] server rejected", params.id, response.status, response.error);
			redirect(302, `${base}/`);
		}

		const data = handleResponse(response) as ConversationData;

		// Persist server-confirmed data to IndexedDB for offline fallback.
		if (browser) {
			void conversationRepository.setConversationDetail(params.id, {
				title: data.title,
				model: data.model,
				updatedAt: data.updatedAt.toISOString(),
				messages: superjson.stringify(data.messages),
				preprompt: data.preprompt,
				rootMessageId: data.rootMessageId,
				shared: data.shared,
				modelId: data.modelId,
			});
		}

		return data;
	}

	// Offline (or network failure): attempt to serve from IndexedDB cache.
	if (browser) {
		try {
			const cached = await conversationRepository.getConversationDetail(params.id);
			if (cached) {
				console.info("[conversation] serving from IndexedDB fallback for", params.id);
				return {
					id: cached.id,
					title: cached.title,
					model: cached.model,
					updatedAt: new Date(cached.updatedAt),
					messages: superjson.parse(cached.messages) as Message[],
					preprompt: cached.preprompt,
					rootMessageId: cached.rootMessageId,
					shared: cached.shared,
					modelId: cached.modelId,
				} satisfies ConversationData;
			}
		} catch (cacheErr) {
			console.error("[conversation] IndexedDB fallback also failed", cacheErr);
		}
	}

	// No cache available either — redirect home.
	console.error("[conversation] load failed for", params.id);
	redirect(302, `${base}/`);
};
