import { redirect } from "@sveltejs/kit";
import { useAPIClient, handleResponse } from "$lib/APIClient";
import { base } from "$app/paths";
import type { PageLoad } from "./$types";
import type { Message } from "$lib/types/Message";

export const load: PageLoad = async ({ params, url, fetch, parent }) => {
	const leafId = url.searchParams.get("leafId");
	const parentData = await parent();
	const client = useAPIClient({ fetch, origin: url.origin });

	// If logged in, import the share and redirect to the new conversation
	if (parentData.loginEnabled && parentData.user && params.id) {
		let importedConversationId: string | undefined;
		try {
			const result = await client.conversations["import-share"]
				.post({ shareId: params.id })
				.then(handleResponse);
			importedConversationId = result.conversationId;
		} catch {
			// Fall through to view-only mode on error
		}

		if (importedConversationId) {
			redirect(
				302,
				`${base}/conversation/${importedConversationId}?leafId=${leafId ?? ""}&fromShare=${params.id}`
			);
		}
	}

	// Not logged in (or import failed): render this page with social preview tags
	// and continue to the view-only conversation client-side. Crawlers scrape the
	// tags here directly — they cannot be served from /conversation/[id] reliably
	// because its +server.ts captures GET requests that don't ask for text/html.
	try {
		const conversation = (await client
			.conversations({ id: params.id })
			.get({ query: {} })
			.then(handleResponse)) as {
			title: string;
			messages: Message[];
			rootMessageId?: string;
		};

		return {
			shareId: params.id,
			leafId,
			title: conversation.title,
			messages: conversation.messages,
			rootMessageId: conversation.rootMessageId,
		};
	} catch {
		redirect(302, `${base}/`);
	}
};
