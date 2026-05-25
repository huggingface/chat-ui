import { browser } from "$app/environment";
import { base } from "$app/paths";
import { redirect } from "@sveltejs/kit";
import { get as getLocalConv } from "$lib/stores/localConversations";
import type { Message } from "$lib/types/Message";
import type { PageLoad } from "./$types";

export const ssr = false;
export const csr = true;

export const load: PageLoad = async ({ params }) => {
	if (!browser) {
		return {
			id: params.id,
			title: "New Chat",
			model: "",
			preprompt: undefined,
			messages: [] as Message[],
			rootMessageId: undefined,
		};
	}

	const conv = await getLocalConv(params.id);
	if (!conv) {
		// Unknown id — bounce back to the homepage. The user can start a new local
		// chat from there.
		redirect(302, `${base}/`);
	}

	return {
		id: conv._id,
		title: conv.title,
		model: conv.model,
		preprompt: conv.preprompt,
		messages: conv.messages,
		rootMessageId: conv.rootMessageId,
	};
};
