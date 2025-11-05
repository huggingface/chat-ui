import { redirect } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";
import { loginEnabled } from "$lib/server/auth";
import { createConversationFromShare } from "$lib/server/conversation";

export const load: PageServerLoad = async ({ url, params, locals, request }) => {
	const leafId = url.searchParams.get("leafId");

	/// if logged in and valid share ID, create conversation from share
	if (loginEnabled && locals.user && params.id) {
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
	return redirect(302, `../conversation/${params.id}?leafId=${leafId}`);
};
