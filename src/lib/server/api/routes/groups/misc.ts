import { Elysia } from "elysia";
import { authPlugin } from "../../authPlugin";
import { requiresUser } from "$lib/server/auth";
import { collections } from "$lib/server/database";
import { authCondition } from "$lib/server/auth";
import { config } from "$lib/server/config";
import { Client } from "@gradio/client";
import yazl from "yazl";
import { downloadFile } from "$lib/server/files/downloadFile";
import mimeTypes from "mime-types";

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
	})
	.get("/export", async ({ locals }) => {
		if (!locals.user) {
			throw new Error("Not logged in");
		}

		if (!locals.isAdmin) {
			throw new Error("Not admin");
		}

		if (config.ENABLE_DATA_EXPORT !== "true") {
			throw new Error("Data export is not enabled");
		}

		const zipfile = new yazl.ZipFile();

		const promises = [
			collections.conversations
				.find({ ...authCondition(locals) })
				.toArray()
				.then(async (conversations) => {
					const formattedConversations = await Promise.all(
						conversations.map(async (conversation) => {
							const hashes: string[] = [];
							conversation.messages.forEach(async (message) => {
								if (message.files) {
									message.files.forEach((file) => {
										hashes.push(file.value);
									});
								}
							});
							const files = await Promise.all(
								hashes.map(async (hash) => {
									try {
										const fileData = await downloadFile(hash, conversation._id);
										return fileData;
									} catch {
										return null;
									}
								})
							);

							const filenames: string[] = [];
							files.forEach((file) => {
								if (!file) return;

								const extension = mimeTypes.extension(file.mime) || "bin";
								const convId = conversation._id.toString();
								const fileId = file.name.split("-")[1].slice(0, 8);
								const fileName = `file-${convId}-${fileId}.${extension}`;
								filenames.push(fileName);
								zipfile.addBuffer(Buffer.from(file.value, "base64"), fileName);
							});

							return {
								...conversation,
								messages: conversation.messages.map((message) => {
									return {
										...message,
										webSearch: message.webSearch
											? {
													prompt: message.webSearch?.prompt,
													searchQuery: message.webSearch?.searchQuery,
													results: message.webSearch?.results.map((result) => result.link),
												}
											: undefined,
										files: filenames,
										updates: undefined,
									};
								}),
							};
						})
					);

					zipfile.addBuffer(
						Buffer.from(JSON.stringify(formattedConversations, null, 2)),
						"conversations.json"
					);
				}),
			collections.assistants
				.find({ createdById: locals.user._id })
				.toArray()
				.then(async (assistants) => {
					const formattedAssistants = await Promise.all(
						assistants.map(async (assistant) => {
							if (assistant.avatar) {
								const fileId = collections.bucket.find({ filename: assistant._id.toString() });

								const content = await fileId.next().then(async (file) => {
									if (!file?._id) return;

									const fileStream = collections.bucket.openDownloadStream(file?._id);

									const fileBuffer = await new Promise<Buffer>((resolve, reject) => {
										const chunks: Uint8Array[] = [];
										fileStream.on("data", (chunk) => chunks.push(chunk));
										fileStream.on("error", reject);
										fileStream.on("end", () => resolve(Buffer.concat(chunks)));
									});

									return fileBuffer;
								});

								if (!content) return;

								zipfile.addBuffer(content, `avatar-${assistant._id.toString()}.jpg`);
							}

							return {
								_id: assistant._id.toString(),
								name: assistant.name,
								createdById: assistant.createdById.toString(),
								createdByName: assistant.createdByName,
								avatar: `avatar-${assistant._id.toString()}.jpg`,
								modelId: assistant.modelId,
								preprompt: assistant.preprompt,
								description: assistant.description,
								dynamicPrompt: assistant.dynamicPrompt,
								exampleInputs: assistant.exampleInputs,
								rag: assistant.rag,
								tools: assistant.tools,
								generateSettings: assistant.generateSettings,
								createdAt: assistant.createdAt.toISOString(),
								updatedAt: assistant.updatedAt.toISOString(),
							};
						})
					);

					zipfile.addBuffer(
						Buffer.from(JSON.stringify(formattedAssistants, null, 2)),
						"assistants.json"
					);
				}),
		];

		await Promise.all(promises);

		zipfile.end();

		// @ts-expect-error - zipfile.outputStream is not typed correctly
		return new Response(zipfile.outputStream, {
			headers: {
				"Content-Type": "application/zip",
				"Content-Disposition": 'attachment; filename="export.zip"',
			},
		});
	});
