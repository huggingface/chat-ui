import { Elysia } from "elysia";
import { authPlugin } from "../../authPlugin";
import { requiresUser } from "$lib/server/auth";
import { collections } from "$lib/server/database";
import { authCondition } from "$lib/server/auth";
import { config } from "$lib/server/config";

export interface FeatureFlags {
	searchEnabled: boolean;
	enableAssistants: boolean;
	enableAssistantsRAG: boolean;
	enableCommunityTools: boolean;
	loginEnabled: boolean;
	loginRequired: boolean;
	guestMode: boolean;
	isAdmin: boolean;
}

export const misc = new Elysia()
	.use(authPlugin)
	.get("/public-config", async () => config.getPublicConfig())
	.get("/feature-flags", async ({ locals }) => {
		let loginRequired = false;
		const messagesBeforeLogin = config.MESSAGES_BEFORE_LOGIN
			? parseInt(config.MESSAGES_BEFORE_LOGIN)
			: 0;
		const nConversations = await collections.conversations.countDocuments(authCondition(locals));

		if (requiresUser && !locals.user) {
			if (messagesBeforeLogin === 0) {
				loginRequired = true;
			} else if (nConversations >= messagesBeforeLogin) {
				loginRequired = true;
			} else {
				// get the number of messages where `from === "assistant"` across all conversations.
				const totalMessages =
					(
						await collections.conversations
							.aggregate([
								{ $match: { ...authCondition(locals), "messages.from": "assistant" } },
								{ $project: { messages: 1 } },
								{ $limit: messagesBeforeLogin + 1 },
								{ $unwind: "$messages" },
								{ $match: { "messages.from": "assistant" } },
								{ $count: "messages" },
							])
							.toArray()
					)[0]?.messages ?? 0;

				loginRequired = totalMessages >= messagesBeforeLogin;
			}
		}

		return {
			searchEnabled: !!(
				config.SERPAPI_KEY ||
				config.SERPER_API_KEY ||
				config.SERPSTACK_API_KEY ||
				config.SEARCHAPI_KEY ||
				config.YDC_API_KEY ||
				config.USE_LOCAL_WEBSEARCH ||
				config.SEARXNG_QUERY_URL ||
				config.BING_SUBSCRIPTION_KEY
			),
			enableAssistants: config.ENABLE_ASSISTANTS === "true",
			enableAssistantsRAG: config.ENABLE_ASSISTANTS_RAG === "true",
			enableCommunityTools: config.COMMUNITY_TOOLS === "true",
			loginEnabled: requiresUser, // misnomer, this is actually whether the feature is available, not required
			loginRequired,
			guestMode: requiresUser && messagesBeforeLogin > 0,
			isAdmin: locals.isAdmin,
		} satisfies FeatureFlags;
	})
	.get("/spaces-config", () => {
		// todo: get spaces config
		return;
	});
