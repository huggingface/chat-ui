import { UrlDependency } from "$lib/types/UrlDependency";
import type { ConvSidebar } from "$lib/types/ConvSidebar";
import { jsonSerialize } from "../lib/utils/serialize";
import { useAPIClient, throwOnError, throwOnErrorNullable } from "$lib/APIClient";
import { getConfigManager } from "$lib/utils/PublicConfig.svelte";

export const load = async ({ depends, fetch }) => {
	depends(UrlDependency.ConversationList);

	const client = useAPIClient({ fetch });

	const settings = await client.user.settings.get().then(throwOnError);
	const models = await client.models.get().then(throwOnError);
	const defaultModel = models[0];

	// if the active model is not in the list of models, its probably an assistant
	// so we fetch it
	const assistantActive = !models.map(({ id }) => id).includes(settings?.activeModel ?? "");

	const assistant = assistantActive
		? await client.assistants({ id: settings?.activeModel }).get().then(throwOnErrorNullable)
		: null;

	const { conversations, nConversations } = await client.conversations
		.get({ query: { p: 0 } })
		.then(throwOnError)
		.then(({ conversations, nConversations }) => {
			return {
				nConversations,
				conversations: conversations.map((conv) => {
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
									avatarUrl: client
										.assistants({ id: conv.assistantId.toString() })
										.get()
										.then(throwOnErrorNullable)
										.then((assistant) => {
											if (!assistant.avatar) {
												return undefined;
											}
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
		assistants: await client.user.assistants.get().then(throwOnError),
		models: await client.models.get().then(throwOnError),
		oldModels: await client.models.old.get().then(throwOnError),
		tools: await client.tools.active.get().then(throwOnError),
		communityToolCount: await client.tools.count.get().then(throwOnError),
		user: await client.user.get().then(throwOnErrorNullable),
		settings: {
			...settings,
			ethicsModalAcceptedAt: settings.ethicsModalAcceptedAt
				? new Date(settings.ethicsModalAcceptedAt)
				: null,
		},
		publicConfig: getConfigManager(await client["public-config"].get().then(throwOnError)),
		...(await client["feature-flags"].get().then(throwOnError)),
	};
};
