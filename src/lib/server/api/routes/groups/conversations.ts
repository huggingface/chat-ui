import { Elysia, error, t } from "elysia";
import { authPlugin } from "$api/authPlugin";
import { collections } from "$lib/server/database";
import { ObjectId } from "mongodb";
import { authCondition } from "$lib/server/auth";
import { models, validModelIdSchema } from "$lib/server/models";
import { convertLegacyConversation } from "$lib/utils/tree/convertLegacyConversation";
import type { Conversation } from "$lib/types/Conversation";

import { CONV_NUM_PER_PAGE } from "$lib/constants/pagination";
import pkg from "natural";
const { PorterStemmer } = pkg;

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
		.get(
			"/search",
			async ({ locals, query }) => {
				const searchQuery = query.q;
				const p = query.p ?? 0;

				if (!searchQuery || searchQuery.length < 3) {
					return [];
				}

				if (!locals.user?._id && !locals.sessionId) {
					throw new Error("Must have a valid session or user");
				}

				const convs = await collections.conversations
					.find({
						sessionId: undefined,
						...authCondition(locals),
						$text: { $search: searchQuery },
					})
					.sort({
						updatedAt: -1, // Sort by date updated in descending order
					})
					.project<
						Pick<
							Conversation,
							"_id" | "title" | "updatedAt" | "model" | "assistantId" | "messages" | "userId"
						>
					>({
						title: 1,
						updatedAt: 1,
						model: 1,
						assistantId: 1,
						messages: 1,
						userId: 1,
					})
					.skip(p * 5)
					.limit(5)
					.toArray()
					.then((convs) =>
						convs.map((conv) => {
							let matchedContent = "";
							let matchedText = "";

							// Find the best match using stemming to handle MongoDB's text search behavior
							let bestMatch = null;
							let bestMatchLength = 0;

							// Simple function to find the best match in content
							const findBestMatch = (
								content: string,
								query: string
							): { start: number; end: number; text: string } | null => {
								const contentLower = content.toLowerCase();
								const queryLower = query.toLowerCase();

								// Try exact word boundary match first
								const wordRegex = new RegExp(
									`\\b${queryLower.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
									"gi"
								);
								const wordMatch = wordRegex.exec(content);
								if (wordMatch) {
									return {
										start: wordMatch.index,
										end: wordMatch.index + wordMatch[0].length - 1,
										text: wordMatch[0],
									};
								}

								// Try simple substring match
								const index = contentLower.indexOf(queryLower);
								if (index !== -1) {
									return {
										start: index,
										end: index + queryLower.length - 1,
										text: content.substring(index, index + queryLower.length),
									};
								}

								return null;
							};

							// Create search variations
							const searchVariations = [searchQuery.toLowerCase()];

							// Add stemmed variations
							try {
								const stemmed = PorterStemmer.stem(searchQuery.toLowerCase());
								if (stemmed !== searchQuery.toLowerCase()) {
									searchVariations.push(stemmed);
								}

								// Find actual words in conversations that stem to the same root
								for (const message of conv.messages) {
									if (message.content) {
										const words = message.content.toLowerCase().match(/\b\w+\b/g) || [];
										words.forEach((word: string) => {
											if (
												PorterStemmer.stem(word) === stemmed &&
												!searchVariations.includes(word)
											) {
												searchVariations.push(word);
											}
										});
									}
								}
							} catch (e) {
								console.warn("Stemming failed for:", searchQuery, e);
							}

							// Add simple variations
							const query = searchQuery.toLowerCase();
							if (query.endsWith("s") && query.length > 3) {
								searchVariations.push(query.slice(0, -1));
							} else if (!query.endsWith("s")) {
								searchVariations.push(query + "s");
							}

							// Search through all messages for the best match
							for (const message of conv.messages) {
								if (!message.content) continue;

								// Try each variation in order of preference
								for (const variation of searchVariations) {
									const match = findBestMatch(message.content, variation);
									if (match) {
										const isExactQuery = variation === searchQuery.toLowerCase();
										const priority = isExactQuery ? 1000 : match.text.length;

										if (priority > bestMatchLength) {
											bestMatch = {
												content: message.content,
												matchStart: match.start,
												matchEnd: match.end,
												matchedText: match.text,
											};
											bestMatchLength = priority;

											// If we found exact query match, we're done
											if (isExactQuery) break;
										}
									}
								}

								// Stop if we found an exact match
								if (bestMatchLength >= 1000) break;
							}

							if (bestMatch) {
								const { content, matchStart, matchEnd } = bestMatch;
								matchedText = bestMatch.matchedText;

								// Create centered context around the match
								const maxContextLength = 160; // Maximum length of actual content (no padding)
								const matchLength = matchEnd - matchStart + 1;

								// Calculate context window - don't exceed maxContextLength even if content is longer
								const availableForContext =
									Math.min(maxContextLength, content.length) - matchLength;
								const contextPerSide = Math.floor(availableForContext / 2);

								// Calculate snippet boundaries to center the match within maxContextLength
								let snippetStart = Math.max(0, matchStart - contextPerSide);
								let snippetEnd = Math.min(
									content.length,
									matchStart + matchLength + contextPerSide
								);

								// Ensure we don't exceed maxContextLength
								if (snippetEnd - snippetStart > maxContextLength) {
									if (matchStart - contextPerSide < 0) {
										// Match is near start, extend end but limit to maxContextLength
										snippetEnd = Math.min(content.length, snippetStart + maxContextLength);
									} else {
										// Match is not near start, limit to maxContextLength from match start
										snippetEnd = Math.min(content.length, snippetStart + maxContextLength);
									}
								}

								// Adjust to word boundaries if possible (but don't move more than 15 chars)
								const originalStart = snippetStart;
								const originalEnd = snippetEnd;

								while (
									snippetStart > 0 &&
									content[snippetStart] !== " " &&
									content[snippetStart] !== "\n" &&
									originalStart - snippetStart < 15
								) {
									snippetStart--;
								}
								while (
									snippetEnd < content.length &&
									content[snippetEnd] !== " " &&
									content[snippetEnd] !== "\n" &&
									snippetEnd - originalEnd < 15
								) {
									snippetEnd++;
								}

								// Extract the content
								let extractedContent = content.substring(snippetStart, snippetEnd).trim();
								// Add ellipsis indicators only
								if (snippetStart > 0) {
									extractedContent = "..." + extractedContent;
								}
								if (snippetEnd < content.length) {
									extractedContent = extractedContent + "...";
								}

								matchedContent = extractedContent;
							} else {
								// Fallback: use beginning of the first message if no match found
								const firstMessage = conv.messages[0];
								if (firstMessage?.content) {
									const content = firstMessage.content;
									matchedContent =
										content.length > 200 ? content.substring(0, 200) + "..." : content;
									matchedText = searchQuery; // Fallback to search query
								}
							}

							return {
								_id: conv._id,
								id: conv._id,
								title: conv.title,
								content: matchedContent,
								matchedText,
								updatedAt: conv.updatedAt,
								model: conv.model,
								assistantId: conv.assistantId,
								modelTools: models.find((m) => m.id == conv.model)?.tools ?? false,
							};
						})
					);

				return convs;
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
							assistant: conversation.assistantId
								? ((await collections.assistants.findOne({
										_id: new ObjectId(conversation.assistantId),
									})) ?? undefined)
								: undefined,
							id: conversation._id.toString(),
							updatedAt: conversation.updatedAt,
							modelId: conversation.model,
							assistantId: conversation.assistantId,
							modelTools: models.find((m) => m.id == conversation.model)?.tools ?? false,
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

							// Only include defined values in the update
							const updateValues = {
								...(body.title !== undefined && { title: body.title }),
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
		);
});
