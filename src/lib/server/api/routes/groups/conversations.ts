import { Elysia, error, t } from "elysia";
import { authPlugin } from "$api/authPlugin";
import { collections } from "$lib/server/database";
import { ObjectId } from "mongodb";
import { authCondition } from "$lib/server/auth";
import { models } from "$lib/server/models";
import { convertLegacyConversation } from "$lib/utils/tree/convertLegacyConversation";
import type { Conversation } from "$lib/types/Conversation";
import { jsonSerialize } from "$lib/utils/serialize";
import { CONV_NUM_PER_PAGE } from "$lib/constants/pagination";

export const conversationGroup = new Elysia().use(authPlugin).group("/conversations", (app) => {
	return app
		.guard({
			as: "scoped",
			beforeHandle: async ({ locals }) => {
				if (!locals.user?._id && !locals.sessionId) {
					return error(401, "Must have a valid session or user");
				}
			},
		})
		.get(
			"",
			async ({ locals, query }) => {
				const convs = await collections.conversations
					.find(authCondition(locals))
					.project<Pick<Conversation, "_id" | "title" | "updatedAt" | "model" | "assistantId">>({
						title: 1,
						updatedAt: 1,
						model: 1,
						assistantId: 1,
					})
					.sort({ updatedAt: -1 })
					.skip((query.p ?? 0) * CONV_NUM_PER_PAGE)
					.limit(CONV_NUM_PER_PAGE)
					.toArray();

				const nConversations = await collections.conversations.countDocuments(
					authCondition(locals)
				);

				const res = convs.map((conv) => ({
					_id: conv._id,
					id: conv._id, // legacy param iOS
					title: conv.title,
					updatedAt: conv.updatedAt,
					model: conv.model,
					modelId: conv.model, // legacy param iOS
					assistantId: conv.assistantId,
					modelTools: models.find((m) => m.id == conv.model)?.tools ?? false,
				}));

				return { conversations: res, nConversations };
			},
			{
				query: t.Object({
					p: t.Optional(t.Number()),
				}),
			}
		)
		.delete("", async ({ locals }) => {
			const res = await collections.conversations.deleteMany({
				...authCondition(locals),
			});
			return res.deletedCount;
		})
		.group(
			"/:id",
			{
				params: t.Object({
					id: t.String(),
				}),
			},
			(app) => {
				return app
					.derive(async ({ locals, params, error }) => {
						let conversation;
						let shared = false;

						// if the conver
						if (params.id.length === 7) {
							// shared link of length 7
							conversation = await collections.sharedConversations.findOne({
								_id: params.id,
							});
							shared = true;

							if (!conversation) {
								return error(404, "Conversation not found");
							}
						} else {
							// todo: add validation on params.id
							try {
								new ObjectId(params.id);
							} catch {
								return error(400, "Invalid conversation ID format");
							}
							conversation = await collections.conversations.findOne({
								_id: new ObjectId(params.id),
								...authCondition(locals),
							});

							if (!conversation) {
								const conversationExists =
									(await collections.conversations.countDocuments({
										_id: new ObjectId(params.id),
									})) !== 0;

								if (conversationExists) {
									return error(
										403,
										"You don't have access to this conversation. If someone gave you this link, ask them to use the 'share' feature instead."
									);
								}

								return error(404, "Conversation not found.");
							}
						}

						const convertedConv = {
							...conversation,
							...convertLegacyConversation(conversation),
							shared,
						};

						return { conversation: convertedConv };
					})
					.get("", async ({ conversation }) => {
						return jsonSerialize({
							messages: conversation.messages,
							title: conversation.title,
							model: conversation.model,
							preprompt: conversation.preprompt,
							rootMessageId: conversation.rootMessageId,
							assistant: conversation.assistantId
								? jsonSerialize(
										(await collections.assistants.findOne({
											_id: new ObjectId(conversation.assistantId),
										})) ?? undefined
									)
								: undefined,
							id: conversation._id.toString(),
							updatedAt: conversation.updatedAt,
							modelId: conversation.model,
							assistantId: conversation.assistantId,
							modelTools: models.find((m) => m.id == conversation.model)?.tools ?? false,
							shared: conversation.shared,
						});
					})
					.post("", () => {
						// todo: post new message
						throw new Error("Not implemented");
					})
					.delete("", () => {
						throw new Error("Not implemented");
					})
					.get("/output/:sha256", () => {
						// todo: get output
						throw new Error("Not implemented");
					})
					.post("/share", () => {
						// todo: share conversation
						throw new Error("Not implemented");
					})
					.post("/stop-generating", () => {
						// todo: stop generating
						throw new Error("Not implemented");
					});
			}
		);
});
