import { redirect } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";
import { loginEnabled } from "$lib/server/auth";
import { createConversationFromShare } from "$lib/server/conversation";

export const load: PageServerLoad = async ({ url, params, locals, request }) => {
	/// if logged in and valid share ID, create conversation from share, usually occurs after login
	if (loginEnabled && locals.user && params.id.length === 7) {
		const leafId = url.searchParams.get("leafId");
		const conversationId = await createConversationFromShare(
			params.id,
			locals,
			request.headers.get("User-Agent") ?? undefined
		);

		return redirect(
			302,
			`../conversation/${conversationId}?leafId=${leafId}&fromShare=${params.id}`
		);
	}
};
