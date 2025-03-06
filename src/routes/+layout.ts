import { UrlDependency } from "$lib/types/UrlDependency";
import type { ConvSidebar } from "$lib/types/ConvSidebar";
import type { ToolFront } from "$lib/types/Tool";
import { base } from "$app/paths";
import { jsonSerialize, type Serialize } from "../lib/utils/serialize";
import type { FeatureFlags } from "$api/routes/groups/misc";
import type { UserGETAssistants, UserGETFront, UserGETSettings } from "$api/routes/groups/user";
import type { GETModelsResponse, GETOldModelsResponse } from "$api/routes/groups/models";
import type { Assistant } from "$lib/types/Assistant";
import type { GETConversationsResponse } from "$api/routes/groups/conversations";
import { fetchJSON } from "$lib/utils/fetchJSON";

export const load = async ({ depends, fetch }) => {
	depends(UrlDependency.ConversationList);

	const settings = await fetchJSON<UserGETSettings>(`${base}/api/v2/user/settings`, { fetch });
	const models = await fetchJSON<GETModelsResponse>(`${base}/api/v2/models`, { fetch });
	const defaultModel = models[0];

	// if the active model is not in the list of models, its probably an assistant
	// so we fetch it
	const assistantActive = !models.map(({ id }) => id).includes(settings?.activeModel ?? "");

	const assistant = assistantActive
		? await fetchJSON<Serialize<Assistant>>(`${base}/api/v2/assistants/${settings?.activeModel}`, {
				fetch,
				allowNull: true,
			})
		: null;

	const { conversations, nConversations } = await fetchJSON<GETConversationsResponse>(
		`${base}/api/v2/conversations`,
		{ fetch }
	).then(({ conversations, nConversations }) => {
		return {
			nConversations,
			conversations: (conversations ?? []).map((conv) => {
				if (settings?.hideEmojiOnSidebar) {
					conv.title = conv.title.replace(/\p{Emoji}/gu, "");
				}

				// remove invalid unicode and trim whitespaces
				conv.title = conv.title.replace(/\uFFFD/gu, "").trimStart();

				return {
					id: conv._id.toString(),
					title: conv.title,
					model: conv.model ?? defaultModel,
					updatedAt: new Date(conv.updatedAt),
					...(conv.assistantId
						? {
								assistantId: conv.assistantId.toString(),
								avatarUrl: fetch(`${base}/api/v2/assistants/${conv.assistantId}`)
									.then((res) => res.json() as Promise<Serialize<Assistant>>)
									.then((assistant) => {
										if (!assistant.avatar) {
											return undefined;
										}

										return `/settings/assistants/${conv.assistantId}/avatar.jpg?hash=${assistant.avatar}`;
									}),
							}
						: {}),
				} satisfies ConvSidebar;
			}),
		};
	});

	return {
		nConversations,
		conversations,
		assistant: assistant ? jsonSerialize(assistant) : undefined,
		assistants: await fetchJSON<UserGETAssistants>(`${base}/api/v2/user/assistants`, { fetch }),
		models: await fetchJSON<GETModelsResponse>(`${base}/api/v2/models`, { fetch }),
		oldModels: await fetchJSON<GETOldModelsResponse>(`${base}/api/v2/models/old`, { fetch }),
		tools: await fetchJSON<ToolFront[]>(`${base}/api/v2/tools/active`, { fetch }),
		communityToolCount: await fetchJSON<number>(`${base}/api/v2/tools/count`, { fetch }),
		user: await fetchJSON<UserGETFront>(`${base}/api/v2/user`, { fetch, allowNull: true }),
		settings: {
			...settings,
			ethicsModalAcceptedAt: settings.ethicsModalAcceptedAt
				? new Date(settings.ethicsModalAcceptedAt)
				: null,
		},
		...(await fetchJSON<FeatureFlags>(`${base}/api/v2/feature-flags`, { fetch })),
	};
};
