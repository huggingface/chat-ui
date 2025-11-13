import { models, validModelIdSchema } from "$lib/server/models";
import { ERROR_MESSAGES } from "$lib/stores/errors";
import type { Message } from "$lib/types/Message";
import type { Conversation } from "$lib/types/Conversation";
import { error } from "@sveltejs/kit";
import { z } from "zod";
import {
	MessageUpdateStatus,
	MessageUpdateType,
	type MessageUpdate,
} from "$lib/types/MessageUpdate";
import { uploadFile } from "$lib/server/files/uploadFile";
import { isMessageId } from "$lib/utils/tree/isMessageId";
import { buildSubtree } from "$lib/utils/tree/buildSubtree.js";
import { addChildren } from "$lib/utils/tree/addChildren.js";
import { addSibling } from "$lib/utils/tree/addSibling.js";
import { usageLimits } from "$lib/server/usageLimits";
import { textGeneration } from "$lib/server/textGeneration";
import type { TextGenerationContext } from "$lib/server/textGeneration/types";
import { logger } from "$lib/server/logger.js";
import { AbortRegistry } from "$lib/server/abortRegistry";
import { MetricsServer } from "$lib/server/metrics";
import {
	callSecurityApi,
	mergeSecurityApiConfig,
} from "$lib/server/security/securityApi";
import { endpoints } from "$lib/server/endpoints/endpoints";

export async function POST({
	request,
	locals,
	params,
	getClientAddress,
}: {
	request: Request;
	locals: App.Locals;
	params: { id: string };
	getClientAddress: () => string;
}) {
	const id = z.string().parse(params.id);
	const promptedAt = new Date();

	const userId = locals.user?._id ?? locals.sessionId;

	// check user
	if (!userId) {
		error(401, "Unauthorized");
	}

	// Parse the content of the request
	const form = await request.formData();

	const json = form.get("data");
	const conversationJson = form.get("conversation");
	const globalSettingsJson = form.get("globalSettings");

	if (!json || typeof json !== "string") {
		error(400, "Invalid request");
	}

	// Parse global settings
	let globalSettings: {
		securityApiEnabled?: boolean;
		securityApiUrl?: string;
		securityApiKey?: string;
		llmApiUrl?: string;
		llmApiKey?: string;
	} = {};
	if (globalSettingsJson && typeof globalSettingsJson === "string") {
		try {
			globalSettings = z
				.object({
					securityApiEnabled: z.boolean().optional(),
					securityApiUrl: z.string().optional(),
					securityApiKey: z.string().optional(),
					llmApiUrl: z.string().optional(),
					llmApiKey: z.string().optional(),
				})
				.parse(JSON.parse(globalSettingsJson));
		} catch (err) {
			// Ignore parsing errors for global settings
			console.warn("Failed to parse global settings:", err);
		}
	}

	// Get conversation data from request body (client-side storage)
	let conv: Conversation;
	if (conversationJson && typeof conversationJson === "string") {
		try {
			conv = z
				.object({
					id: z.string(),
					model: z.string(),
					title: z.string(),
					messages: z.array(z.any()),
					rootMessageId: z.string().optional(),
					preprompt: z.string().optional(),
					meta: z
						.object({
							fromShareId: z.string().optional(),
							securityApiEnabled: z.boolean().optional(),
							securityApiUrl: z.string().optional(),
							securityApiKey: z.string().optional(),
							llmApiUrl: z.string().optional(),
							llmApiKey: z.string().optional(),
						})
						.optional(),
					createdAt: z.string().or(z.date()),
					updatedAt: z.string().or(z.date()),
				})
				.parse(JSON.parse(conversationJson)) as Conversation;

			// Convert date strings to Date objects if needed
			if (typeof conv.createdAt === "string") {
				conv.createdAt = new Date(conv.createdAt);
			}
			if (typeof conv.updatedAt === "string") {
				conv.updatedAt = new Date(conv.updatedAt);
			}

			// Ensure conversation ID matches
			if (conv.id !== id) {
				error(400, "Conversation ID mismatch");
			}
		} catch (err) {
			error(400, "Invalid conversation data");
		}
	} else {
		error(400, "Conversation data required");
	}

	// Simple rate limiting - check message count only
	if (usageLimits?.messages && conv.messages.length > usageLimits.messages) {
		error(
			429,
			`This conversation has more than ${usageLimits.messages} messages. Start a new one to continue`
		);
	}

	// Fetch the model
	const model = models.find((m) => m.id === conv.model);

	if (!model) {
		error(410, "Model not available anymore");
	}

	const {
		inputs: newPrompt,
		id: messageId,
		is_retry: isRetry,
	} = z
		.object({
			id: z.string().uuid().refine(isMessageId).optional(), // parent message id to append to for a normal message, or the message id for a retry/continue
			inputs: z.optional(
				z
					.string()
					.min(1)
					.transform((s) => s.replace(/\r\n/g, "\n"))
			),
			is_retry: z.optional(z.boolean()),
			files: z.optional(
				z.array(
					z.object({
						type: z.literal("base64").or(z.literal("hash")),
						name: z.string(),
						value: z.string(),
						mime: z.string(),
					})
				)
			),
		})
		.parse(JSON.parse(json));

	const inputFiles = await Promise.all(
		form
			.getAll("files")
			.filter((entry): entry is File => entry instanceof File && entry.size > 0)
			.map(async (file: File) => {
				const [type, ...name] = file.name.split(";");

				return {
					type: z.literal("base64").or(z.literal("hash")).parse(type),
					value: await file.text(),
					mime: file.type,
					name: name.join(";"),
				};
			})
	);

	if (usageLimits?.messageLength && (newPrompt?.length ?? 0) > usageLimits.messageLength) {
		error(400, "Message too long.");
	}

	// each file is either:
	// base64 string requiring upload to the server
	// hash pointing to an existing file
	const hashFiles = inputFiles?.filter((file) => file.type === "hash") ?? [];
	const b64Files =
		inputFiles
			?.filter((file) => file.type !== "hash")
			.map((file) => {
				const blob = Buffer.from(file.value, "base64");
				return new File([blob], file.name, { type: file.mime });
			}) ?? [];

	// check sizes
	// todo: make configurable
	if (b64Files.some((file) => file.size > 10 * 1024 * 1024)) {
		error(413, "File too large, should be <10MB");
	}

	const uploadedFiles = await Promise.all(b64Files.map((file) => uploadFile(file, conv.id))).then(
		(files) => [...files, ...hashFiles]
	);

	// we will append tokens to the content of this message
	let messageToWriteToId: Message["id"] | undefined = undefined;
	// used for building the prompt, subtree of the conversation that goes from the latest message to the root
	let messagesForPrompt: Message[] = [];

	if (isRetry && messageId) {
		// two cases, if we're retrying a user message with a newPrompt set,
		// it means we're editing a user message
		// if we're retrying on an assistant message, newPrompt cannot be set
		// it means we're retrying the last assistant message for a new answer

		const messageToRetry = conv.messages.find((message) => message.id === messageId);

		if (!messageToRetry) {
			error(404, "Message not found");
		}

		if (messageToRetry.from === "user" && newPrompt) {
			// add a sibling to this message from the user, with the alternative prompt
			// add a children to that sibling, where we can write to
			const newUserMessageId = addSibling(
				conv,
				{
					from: "user",
					content: newPrompt,
					files: uploadedFiles,
					createdAt: new Date(),
					updatedAt: new Date(),
				},
				messageId
			);
			messageToWriteToId = addChildren(
				conv,
				{
					from: "assistant",
					content: "",
					createdAt: new Date(),
					updatedAt: new Date(),
				},
				newUserMessageId
			);
			messagesForPrompt = buildSubtree(conv, newUserMessageId);
		} else if (messageToRetry.from === "assistant") {
			// we're retrying an assistant message, to generate a new answer
			// just add a sibling to the assistant answer where we can write to
			messageToWriteToId = addSibling(
				conv,
				{ from: "assistant", content: "", createdAt: new Date(), updatedAt: new Date() },
				messageId
			);
			messagesForPrompt = buildSubtree(conv, messageId);
			messagesForPrompt.pop(); // don't need the latest assistant message in the prompt since we're retrying it
		}
	} else {
		// just a normal linear conversation, so we add the user message
		// and the blank assistant message back to back
		const newUserMessageId = addChildren(
			conv,
			{
				from: "user",
				content: newPrompt ?? "",
				files: uploadedFiles,
				createdAt: new Date(),
				updatedAt: new Date(),
			},
			messageId
		);

		messageToWriteToId = addChildren(
			conv,
			{
				from: "assistant",
				content: "",
				createdAt: new Date(),
				updatedAt: new Date(),
			},
			newUserMessageId
		);
		// build the prompt from the user message
		messagesForPrompt = buildSubtree(conv, newUserMessageId);
	}

	const messageToWriteTo = conv.messages.find((message) => message.id === messageToWriteToId);
	if (!messageToWriteTo) {
		error(500, "Failed to create message");
	}
	if (messagesForPrompt.length === 0) {
		error(500, "Failed to create prompt");
	}

	// Note: Conversation updates are now handled client-side
	// Server only generates text, client saves to IndexedDB

	let doneStreaming = false;
	let clientDetached = false;

	let lastTokenTimestamp: undefined | Date = undefined;
	let firstTokenObserved = false;
	const metricsEnabled = MetricsServer.isEnabled();
	const metrics = metricsEnabled ? MetricsServer.getMetrics() : undefined;
	const metricsModelId = model.id ?? model.name ?? conv.model;
	const metricsLabels = { model: metricsModelId };

	const abortRegistry = AbortRegistry.getInstance();

	// we now build the stream
	const stream = new ReadableStream({
		async start(controller) {
			const conversationKey = conv.id;
			const ctrl = new AbortController();
			abortRegistry.register(conversationKey, ctrl);

			let finalAnswerReceived = false;
			let abortedByUser = false;

			messageToWriteTo.updates ??= [];
			async function update(event: MessageUpdate) {
				if (!messageToWriteTo || !conv) {
					throw Error("No message or conversation to write events to");
				}

				// Add token to content or skip if empty
				if (event.type === MessageUpdateType.Stream) {
					if (event.token === "") return;
					messageToWriteTo.content += event.token;

					if (metricsEnabled && metrics) {
						const now = Date.now();
						metrics.model.tokenCountTotal.inc(metricsLabels);

						if (!firstTokenObserved) {
							metrics.model.timeToFirstToken.observe(metricsLabels, now - promptedAt.getTime());
							firstTokenObserved = true;
						}

						const previousTimestamp = lastTokenTimestamp
							? lastTokenTimestamp.getTime()
							: promptedAt.getTime();
						metrics.model.timePerOutputToken.observe(metricsLabels, now - previousTimestamp);
					}

					lastTokenTimestamp = new Date();
				}

				// Set the title
				else if (event.type === MessageUpdateType.Title) {
					// Always strip <think> markers from titles when saving
					const sanitizedTitle = event.title.replace(/<\/?think>/gi, "").trim();
					conv.title = sanitizedTitle;
					// Title update is handled client-side, no server-side persistence needed
				}

				// Set the final text and the interrupted flag
				else if (event.type === MessageUpdateType.FinalAnswer) {
					messageToWriteTo.interrupted = event.interrupted;
					messageToWriteTo.content = initialMessageContent + event.text;
					finalAnswerReceived = true;

					if (metricsEnabled && metrics) {
						metrics.model.latency.observe(metricsLabels, Date.now() - promptedAt.getTime());
					}
				}

				// Add file
				else if (event.type === MessageUpdateType.File) {
					messageToWriteTo.files = [
						...(messageToWriteTo.files ?? []),
						{ type: "hash", name: event.name, value: event.sha, mime: event.mime },
					];
				}

				// Store debug information (always store for visibility)
				else if (event.type === MessageUpdateType.Debug) {
					// Debug info is always stored in updates for visibility
					// No special handling needed - it's already in the updates array
				}

				// Store router metadata (for router models) or provider info (for all models)
				else if (event.type === MessageUpdateType.RouterMetadata) {
					// Merge metadata updates to preserve existing fields (router may send route/model first, then provider comes later)
					if (model?.isRouter) {
						messageToWriteTo.routerMetadata = {
							route: event.route || messageToWriteTo.routerMetadata?.route || "",
							model: event.model || messageToWriteTo.routerMetadata?.model || "",
							provider: event.provider || messageToWriteTo.routerMetadata?.provider,
						};
					}
					// Store provider-only metadata for non-router models if available
					else if (event.provider) {
						messageToWriteTo.routerMetadata = {
							route: messageToWriteTo.routerMetadata?.route || "",
							model: messageToWriteTo.routerMetadata?.model || "",
							provider: event.provider,
						};
					}
				}

				// Append to the persistent message updates if it's not a stream update
				if (
					event.type !== MessageUpdateType.Stream &&
					!(
						event.type === MessageUpdateType.Status &&
						event.status === MessageUpdateStatus.KeepAlive
					)
				) {
					messageToWriteTo?.updates?.push(event);
				}

				// Avoid remote keylogging attack executed by watching packet lengths
				// by padding the text with null chars to a fixed length
				// https://cdn.arstechnica.net/wp-content/uploads/2024/03/LLM-Side-Channel.pdf
				if (event.type === MessageUpdateType.Stream) {
					event = { ...event, token: event.token.padEnd(16, "\0") };
				}

				messageToWriteTo.updatedAt = new Date();

				const enqueueUpdate = async () => {
					if (clientDetached) return;
					try {
						controller.enqueue(JSON.stringify(event) + "\n");
						if (event.type === MessageUpdateType.FinalAnswer) {
							controller.enqueue(" ".repeat(4096));
						}
					} catch (err) {
						clientDetached = true;
						logger.info({ conversationId: conv.id }, "Client detached during message streaming");
					}
				};

				await enqueueUpdate();

				// Conversation persistence is handled client-side
			}

			let hasError = false;
			const initialMessageContent = messageToWriteTo.content;

			// Security API call and timing
			const totalStartTime = Date.now();
			let securityApiResult: {
				response: Awaited<ReturnType<typeof callSecurityApi>>["response"];
				securityResponseTime: number;
				error?: string;
			} | null = null;
			let originalRequest: unknown = null;
			let securityResponse: unknown = null;
			let llmRequest: unknown = null;
			let finalLlmResponse: unknown = null;
			let llmResponseTime = 0;
			const llmStartTime = Date.now();

			try {
				// Merge security API config from conversation meta and global settings
				const securityConfig = mergeSecurityApiConfig(conv.meta, globalSettings);

				if (securityConfig) {
					// Prepare original request for security API
					originalRequest = {
						model: model.id ?? model.name,
						messages: messagesForPrompt.map((msg) => ({
							role: msg.from === "user" ? "user" : msg.from === "assistant" ? "assistant" : "system",
							content: msg.content,
						})),
					};

					// Call security API
					securityApiResult = await callSecurityApi(
						messagesForPrompt,
						securityConfig,
						ctrl.signal
					);

					securityResponse = securityApiResult.response;

					// Handle security API response
					if (securityApiResult.error) {
						await update({
							type: MessageUpdateType.Debug,
							originalRequest: originalRequest as {
								model?: string;
								messages?: unknown[];
								[key: string]: unknown;
							},
							securityResponse: {
								action: "block",
								reason: securityApiResult.error,
							},
							securityResponseTime: securityApiResult.securityResponseTime,
							error: securityApiResult.error,
							totalTime: Date.now() - totalStartTime,
						});
						throw new Error(`Security API error: ${securityApiResult.error}`);
					}

					// If security API returned a response, use it to modify messages
					if (securityApiResult.response?.choices?.[0]?.message?.content) {
						// Security API modified the message - use the modified content
						const modifiedContent = securityApiResult.response.choices[0].message.content;
						// Update the last user message with modified content
						if (messagesForPrompt.length > 0) {
							const lastMessage = messagesForPrompt[messagesForPrompt.length - 1];
							if (lastMessage.from === "user") {
								messagesForPrompt = [
									...messagesForPrompt.slice(0, -1),
									{ ...lastMessage, content: modifiedContent },
								];
							}
						}
					}
				}

				// Get endpoint with user settings override if provided
				let endpoint = await model.getEndpoint();
				const llmApiUrl = conv.meta?.llmApiUrl ?? globalSettings.llmApiUrl;
				const llmApiKey = conv.meta?.llmApiKey ?? globalSettings.llmApiKey;

				// Override endpoint with user-provided LLM API settings if available
				if ((llmApiUrl || llmApiKey) && model.endpoints?.[0]?.type === "openai") {
					const originalEndpoint = model.endpoints[0];
					endpoint = await endpoints.openai({
						type: "openai",
						baseURL: llmApiUrl || originalEndpoint.baseURL || "https://api.openai.com/v1",
						apiKey: llmApiKey || originalEndpoint.apiKey || config.OPENAI_API_KEY || "sk-",
						model: model,
						completion: originalEndpoint.completion || "chat_completions",
						defaultHeaders: originalEndpoint.defaultHeaders,
						defaultQuery: originalEndpoint.defaultQuery,
						extraBody: originalEndpoint.extraBody,
						multimodal: originalEndpoint.multimodal,
						useCompletionTokens: originalEndpoint.useCompletionTokens,
						streamingSupported: originalEndpoint.streamingSupported ?? false,
					});
				}

				const ctx: TextGenerationContext = {
					model,
					endpoint,
					conv,
					messages: messagesForPrompt,
					assistant: undefined,
					promptedAt,
					ip: getClientAddress(),
					username: locals.user?.username,
					// Settings are now client-side, multimodal override is not available server-side
					forceMultimodal: false,
					locals,
					abortController: ctrl,
				};

				// Prepare LLM request (for debug info)
				llmRequest = {
					model: model.id ?? model.name,
					messages: messagesForPrompt.map((msg) => ({
						role: msg.from === "user" ? "user" : msg.from === "assistant" ? "assistant" : "system",
						content: msg.content,
					})),
				};

				// run the text generation and send updates to the client
				for await (const event of textGeneration(ctx)) {
					// Capture final LLM response if available
					if (event.type === MessageUpdateType.FinalAnswer) {
						finalLlmResponse = {
							text: event.text,
							interrupted: event.interrupted,
						};
						llmResponseTime = Date.now() - llmStartTime;
					}
					await update(event);
				}

				// Send debug info if security API was used
				if (securityConfig && securityApiResult) {
					const totalTime = Date.now() - totalStartTime;
					await update({
						type: MessageUpdateType.Debug,
						originalRequest: originalRequest as {
							model?: string;
							messages?: unknown[];
							[key: string]: unknown;
						},
						securityResponse: securityApiResult.response
							? {
									action: "allow",
									reason: "Security API approved",
									modifiedKwargs: securityApiResult.response,
								}
							: undefined,
						securityResponseTime: securityApiResult.securityResponseTime,
						llmRequest: llmRequest as {
							model?: string;
							messages?: unknown[];
							[key: string]: unknown;
						},
						finalLlmResponse: finalLlmResponse as {
							id?: string;
							choices?: unknown[];
							model?: string;
							usage?: unknown;
							[key: string]: unknown;
						},
						llmResponseTime,
						totalTime,
					});
				}
				if (ctrl.signal.aborted) {
					abortedByUser = true;
				}
				if (abortedByUser && !finalAnswerReceived) {
					const partialText = messageToWriteTo.content.slice(initialMessageContent.length);
					await update({
						type: MessageUpdateType.FinalAnswer,
						text: partialText,
						interrupted: true,
					});
				}
			} catch (e) {
				const err = e as Error;
				const isAbortError =
					err?.name === "AbortError" ||
					err?.name === "APIUserAbortError" ||
					err?.message === "Request was aborted.";
				if (isAbortError || ctrl.signal.aborted) {
					abortedByUser = true;
					logger.info({ conversationId: conv.id }, "Generation aborted by user");
					if (!finalAnswerReceived) {
						const partialText = messageToWriteTo.content.slice(initialMessageContent.length);
						await update({
							type: MessageUpdateType.FinalAnswer,
							text: partialText,
							interrupted: true,
						});
					}
				} else {
					// Return dummy response instead of error when generation fails
					const dummyResponse =
						"This is a dummy response. The actual model service is not available, but you can still test the UI functionality.";

					// Stream the dummy response token by token for realistic behavior
					const tokens = dummyResponse.split(" ");
					for (let i = 0; i < tokens.length; i++) {
						if (ctrl.signal.aborted) break;
						const token = i === 0 ? tokens[i] : " " + tokens[i];
						await update({
							type: MessageUpdateType.Stream,
							token: token,
						});
						// Small delay between tokens for realistic streaming
						await new Promise((resolve) => setTimeout(resolve, 50));
					}

					// Send final answer
					await update({
						type: MessageUpdateType.FinalAnswer,
						text: dummyResponse,
						interrupted: false,
					});
					finalAnswerReceived = true;
					logger.warn(
						{ conversationId: conv.id },
						"Generation failed, returning dummy response",
						err
					);
				}
			} finally {
				// check if no output was generated
				if (!hasError && !abortedByUser && messageToWriteTo.content === initialMessageContent) {
					// Return dummy response if no output was generated
					const dummyResponse =
						"This is a dummy response. The actual model service is not available, but you can still test the UI functionality.";

					// Stream the dummy response token by token
					const tokens = dummyResponse.split(" ");
					for (let i = 0; i < tokens.length; i++) {
						const token = i === 0 ? tokens[i] : " " + tokens[i];
						await update({
							type: MessageUpdateType.Stream,
							token: token,
						});
						await new Promise((resolve) => setTimeout(resolve, 50));
					}

					await update({
						type: MessageUpdateType.FinalAnswer,
						text: dummyResponse,
						interrupted: false,
					});
				}
			}

			// Conversation persistence is handled client-side
			abortRegistry.unregister(conversationKey, ctrl);

			// used to detect if cancel() is called bc of interrupt or just because the connection closes
			doneStreaming = true;
			if (!clientDetached) {
				controller.close();
			}
		},
		async cancel() {
			if (doneStreaming) return;
			clientDetached = true;
			// Conversation persistence is handled client-side
		},
	});

	if (metricsEnabled && metrics) {
		metrics.model.messagesTotal.inc(metricsLabels);
	}

	// Todo: maybe we should wait for the message to be saved before ending the response - in case of errors
	return new Response(stream, {
		headers: {
			"Content-Type": "application/jsonl",
		},
	});
}

export async function DELETE({ params }: { params: { id: string } }) {
	// Conversation deletion is handled client-side
	// This endpoint is kept for backward compatibility but does nothing
	return new Response();
}

export async function PATCH({ request }: { request: Request; params: { id: string } }) {
	// Conversation updates are handled client-side
	// This endpoint is kept for backward compatibility but does nothing
	return new Response();
}
