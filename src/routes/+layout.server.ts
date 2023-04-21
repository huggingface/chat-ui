import type { LayoutServerLoad } from "./$types";
import { listConversations } from "$lib/server/listConversations";

export const load: LayoutServerLoad = async (event) => {
	return {
		conversations: await listConversations(event.locals.sessionId),
	};
};
