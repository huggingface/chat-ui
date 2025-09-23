import { Elysia, error, t } from "elysia";
import { authPlugin } from "$api/authPlugin";
import { collections } from "$lib/server/database";
import { ObjectId } from "mongodb";
import { authCondition } from "$lib/server/auth";
import { validModelIdSchema } from "$lib/server/models";
import { convertLegacyConversation } from "$lib/utils/tree/convertLegacyConversation";
import type { Conversation } from "$lib/types/Conversation";

import { CONV_NUM_PER_PAGE } from "$lib/constants/pagination";

export const conversationGroup = new Elysia().use(authPlugin).group("/conversations", (app) => {
	return (
		app
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
						.project<Pick<Conversation, "_id" | "title" | "updatedAt" | "model">>({
							title: 1,
							updatedAt: 1,
							model: 1,
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
			.get(
				"/search",
				async ({ locals, query }) => {
					const q = (query.q ?? "").trim();
					const p = Number.isFinite(query.p) ? Number(query.p) : 0;

					if (q.length < 3) {
						return [];
					}

					if (!locals.user?._id && !locals.sessionId) {
						throw new Error("Must have a valid session or user");
					}

					const baseFilter = {
						sessionId: undefined,
						...authCondition(locals),
					};

					const projection = {
						_id: 1,
						title: 1,
						updatedAt: 1,
						model: 1,
						messages: 1,
					} as const;

					const makeSnippet = (messages?: Conversation["messages"]) => {
						if (!Array.isArray(messages) || messages.length === 0) return "";
						const first = messages.find((m) => typeof m?.content === "string" && m.content.trim());
						const text = (first?.content ?? messages[0]?.content ?? "") as string;
						return text.length > 160 ? `${text.slice(0, 160)}...` : text;
					};

					const limit = 5;

					try {
						const byText = await collections.conversations
							.find({ ...baseFilter, $text: { $search: q } })
							.project(projection as any)
							.sort({ score: { $meta: "textScore" }, updatedAt: -1 } as any)
							.skip(p * limit)
							.limit(limit)
							.toArray();

						return byText.map((conv) => ({
							_id: conv._id,
							id: conv._id,
							title: conv.title,
							content: makeSnippet(conv.messages),
							updatedAt: conv.updatedAt,
							model: conv.model,
						}));
					} catch {
						const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
						const regex = new RegExp(escaped, "i");
						const byRegex = await collections.conversations
							.find({
								...baseFilter,
								$or: [{ title: regex }, { "messages.content": regex }],
							})
							.project(projection as any)
							.sort({ updatedAt: -1 })
							.skip(p * limit)
							.limit(limit)
							.toArray();

						return byRegex.map((conv) => ({
							_id: conv._id,
							id: conv._id,
							title: conv.title,
							content: makeSnippet(conv.messages),
							updatedAt: conv.updatedAt,
							model: conv.model,
						}));
					}
				},
				{
					query: t.Object({
						q: t.String(),
						p: t.Optional(t.Number()),
					}),
				}
			)
			.group(
				"/:id",
				{
					params: t.Object({
						id: t.String(),
					}),
				},
				(app) => {
					return app
						.derive(async ({ locals, params }) => {
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
									throw new Error("Conversation not found");
								}
							} else {
								// todo: add validation on params.id
								try {
									new ObjectId(params.id);
								} catch {
									throw new Error("Invalid conversation ID format");
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
										throw new Error(
											"You don't have access to this conversation. If someone gave you this link, ask them to use the 'share' feature instead."
										);
									}

									throw new Error("Conversation not found.");
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
							return {
								messages: conversation.messages,
								title: conversation.title,
								model: conversation.model,
								preprompt: conversation.preprompt,
								rootMessageId: conversation.rootMessageId,
								id: conversation._id.toString(),
								updatedAt: conversation.updatedAt,
								modelId: conversation.model,
								shared: conversation.shared,
							};
						})
						.post("", () => {
							// todo: post new message
							throw new Error("Not implemented");
						})
						.delete("", async ({ locals, params }) => {
							const res = await collections.conversations.deleteOne({
								_id: new ObjectId(params.id),
								...authCondition(locals),
							});

							if (res.deletedCount === 0) {
								throw new Error("Conversation not found");
							}

							return { success: true };
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
						})
						.patch(
							"",
							async ({ locals, params, body }) => {
								if (body.model) {
									if (!validModelIdSchema.safeParse(body.model).success) {
										throw new Error("Invalid model ID");
									}
								}

								// Only include defined values in the update (sanitize title)
								const updateValues = {
									...(body.title !== undefined && {
										title: body.title.replace(/<\/?think>/gi, "").trim(),
									}),
									...(body.model !== undefined && { model: body.model }),
								};

								const res = await collections.conversations.updateOne(
									{
										_id: new ObjectId(params.id),
										...authCondition(locals),
									},
									{
										$set: updateValues,
									}
								);

								if (res.modifiedCount === 0) {
									throw new Error("Conversation not found");
								}

								return { success: true };
							},
							{
								body: t.Object({
									title: t.Optional(
										t.String({
											minLength: 1,
											maxLength: 100,
										})
									),
									model: t.Optional(t.String()),
								}),
							}
						)
						.delete(
							"/message/:messageId",
							async ({ locals, params, conversation }) => {
								if (!conversation.messages.map((m) => m.id).includes(params.messageId)) {
									throw new Error("Message not found");
								}

								const filteredMessages = conversation.messages
									.filter(
										(message) =>
											// not the message AND the message is not in ancestors
											!(message.id === params.messageId) &&
											message.ancestors &&
											!message.ancestors.includes(params.messageId)
									)
									.map((message) => {
										// remove the message from children if it's there
										if (message.children && message.children.includes(params.messageId)) {
											message.children = message.children.filter(
												(child) => child !== params.messageId
											);
										}
										return message;
									});

								const res = await collections.conversations.updateOne(
									{ _id: new ObjectId(conversation._id), ...authCondition(locals) },
									{ $set: { messages: filteredMessages } }
								);

								if (res.modifiedCount === 0) {
									throw new Error("Deleting message failed");
								}

								return { success: true };
							},
							{
								params: t.Object({
									id: t.String(),
									messageId: t.String(),
								}),
							}
						);
				}
			)
	);
});
