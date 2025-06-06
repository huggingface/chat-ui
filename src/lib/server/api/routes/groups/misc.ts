import { Elysia } from "elysia";
import { authPlugin } from "../../authPlugin";
import { requiresUser } from "$lib/server/auth";
import { collections } from "$lib/server/database";
import { authCondition } from "$lib/server/auth";
import { config } from "$lib/server/config";
import { Client } from "@gradio/client";

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

export type ApiReturnType = Awaited<ReturnType<typeof Client.prototype.view_api>>;

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
	.get("/spaces-config", async ({ query }) => {
		if (config.COMMUNITY_TOOLS !== "true") {
			throw new Error("Community tools are not enabled");
		}

		const space = query.space;

		if (!space) {
			throw new Error("Missing space");
		}

		// Extract namespace from space URL or use as-is if it's already in namespace format
		let namespace = null;
		if (space.startsWith("https://huggingface.co/spaces/")) {
			namespace = space.split("/").slice(-2).join("/");
		} else if (space.match(/^[^/]+\/[^/]+$/)) {
			namespace = space;
		}

		if (!namespace) {
			throw new Error("Invalid space name. Specify a namespace or a full URL on huggingface.co.");
		}

		try {
			const api = await (await Client.connect(namespace)).view_api();
			return api as ApiReturnType;
		} catch (e) {
			throw new Error("Error fetching space API. Is the name correct?");
		}
	});
