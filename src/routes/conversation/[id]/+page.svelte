<script lang="ts">
	import ChatWindow from "$lib/components/chat/ChatWindow.svelte";
	import { pendingMessage } from "$lib/stores/pendingMessage";
	import { pendingMessageIdToRetry } from "$lib/stores/pendingMessageIdToRetry";
	import { onMount } from "svelte";
	import { page } from "$app/stores";
	import { textGenerationStream, type Options } from "@huggingface/inference";
	import { invalidate } from "$app/navigation";
	import { base } from "$app/paths";
	import { shareConversation } from "$lib/shareConversation";
	import { UrlDependency } from "$lib/types/UrlDependency";
	import { ERROR_MESSAGES, error } from "$lib/stores/errors";
	import { randomUUID } from "$lib/utils/randomUuid";
	import { findCurrentModel } from "$lib/utils/models";
	import { webSearchParameters } from "$lib/stores/webSearchParameters";
	import type { WebSearchMessage } from "$lib/types/WebSearch";
	import type { Message } from "$lib/types/Message";
	import { PUBLIC_APP_DISCLAIMER } from "$env/static/public";

	export let data;

	let messages = data.messages;
	let lastLoadedMessages = data.messages;
	let isAborted = false;

	let webSearchMessages: WebSearchMessage[] = [];

	// Since we modify the messages array locally, we don't want to reset it if an old version is passed
	$: if (data.messages !== lastLoadedMessages) {
		messages = data.messages;
		lastLoadedMessages = data.messages;
	}

	let loading = false;
	let pending = false;
	let loginRequired = false;

	async function getTextGenerationStream(
		inputs: string,
		messageId: string,
		isRetry = false,
		webSearchId?: string
	) {
		let conversationId = $page.params.id;
		const responseId = randomUUID();

		const response = textGenerationStream(
			{
				model: $page.url.href,
				inputs,
				parameters: {
					...data.models.find((m) => m.id === data.model)?.parameters,
					return_full_text: false,
				},
			},
			{
				id: messageId,
				response_id: responseId,
				is_retry: isRetry,
				use_cache: false,
				web_search_id: webSearchId,
			} as Options
		);

		for await (const output of response) {
			pending = false;

			if (!output) {
				break;
			}

			if (conversationId !== $page.params.id) {
				fetch(`${base}/conversation/${conversationId}/stop-generating`, {
					method: "POST",
				}).catch(console.error);
				break;
			}

			if (isAborted) {
				isAborted = false;
				fetch(`${base}/conversation/${conversationId}/stop-generating`, {
					method: "POST",
				}).catch(console.error);
				break;
			}

			// final message
			if (output.generated_text) {
				const lastMessage = messages[messages.length - 1];

				if (lastMessage) {
					lastMessage.content = output.generated_text;
					lastMessage.webSearchId = webSearchId;
					messages = [...messages];
				}
				break;
			}

			if (!output.token.special) {
				const lastMessage = messages[messages.length - 1];

				if (lastMessage?.from !== "assistant") {
					// First token has a space at the beginning, trim it
					messages = [
						...messages,
						// id doesn't match the backend id but it's not important for assistant messages
						{ from: "assistant", content: output.token.text.trimStart(), id: responseId },
					];
				} else {
					lastMessage.content += output.token.text;
					messages = [...messages];
				}
			}
		}
	}

	async function summarizeTitle(id: string) {
		await fetch(`${base}/conversation/${id}/summarize`, {
			method: "POST",
		});
	}

	async function writeMessage(message: string, messageId = randomUUID()) {
		if (!message.trim()) return;

		try {
			isAborted = false;
			loading = true;
			pending = true;

			let retryMessageIndex = messages.findIndex((msg) => msg.id === messageId);
			const isRetry = retryMessageIndex !== -1;
			if (!isRetry) {
				retryMessageIndex = messages.length;
			}

			messages = [
				...messages.slice(0, retryMessageIndex),
				{ from: "user", content: message, id: messageId },
			];

			let searchResponseId: string | null = "";
			if ($webSearchParameters.useSearch) {
				webSearchMessages = [];

				const res = await fetch(
					`${base}/conversation/${$page.params.id}/web-search?` +
						new URLSearchParams({ prompt: message }),
					{
						method: "GET",
					}
				);

				// required bc linting doesn't see TextDecoderStream for some reason?
				// eslint-disable-next-line no-undef
				const encoder = new TextDecoderStream();
				const reader = res?.body?.pipeThrough(encoder).getReader();

				while (searchResponseId === "") {
					await new Promise((r) => setTimeout(r, 25));

					if (isAborted) {
						reader?.cancel();
						return;
					}

					reader
						?.read()
						.then(async ({ done, value }) => {
							if (done) {
								reader.cancel();
								return;
							}

							try {
								webSearchMessages = (JSON.parse(value) as { messages: WebSearchMessage[] })
									.messages;
							} catch (parseError) {
								// in case of parsing error we wait for the next message
								return;
							}

							const lastSearchMessage = webSearchMessages[webSearchMessages.length - 1];
							if (lastSearchMessage.type === "result") {
								searchResponseId = lastSearchMessage.id;
								reader.cancel();
								return;
							}
						})
						.catch(() => {
							searchResponseId = null;
						});
				}
			}

			await getTextGenerationStream(message, messageId, isRetry, searchResponseId ?? undefined);

			webSearchMessages = [];

			if (messages.filter((m) => m.from === "user").length === 1) {
				summarizeTitle($page.params.id)
					.then(() => invalidate(UrlDependency.ConversationList))
					.catch(console.error);
			} else {
				await invalidate(UrlDependency.ConversationList);
			}
		} catch (err) {
			if (err instanceof Error && err.message.includes("overloaded")) {
				$error = "Too much traffic, please try again.";
			} else if (err instanceof Error && err.message.includes("429")) {
				$error = ERROR_MESSAGES.rateLimited;
			} else if (err instanceof Error) {
				$error = err.message;
			} else {
				$error = ERROR_MESSAGES.default;
			}
			console.error(err);
		} finally {
			loading = false;
			pending = false;
		}
	}

	async function voteMessage(score: Message["score"], messageId: string) {
		let conversationId = $page.params.id;
		let oldScore: Message["score"] | undefined;

		// optimistic update to avoid waiting for the server
		messages = messages.map((message) => {
			if (message.id === messageId) {
				oldScore = message.score;
				return { ...message, score: score };
			}
			return message;
		});

		try {
			await fetch(`${base}/conversation/${conversationId}/message/${messageId}/vote`, {
				method: "POST",
				body: JSON.stringify({ score }),
			});
		} catch {
			// revert score on any error
			messages = messages.map((message) => {
				return message.id !== messageId ? message : { ...message, score: oldScore };
			});
		}
	}

	onMount(async () => {
		if ($pendingMessage) {
			const val = $pendingMessage;
			const messageId = $pendingMessageIdToRetry || undefined;
			$pendingMessage = "";
			$pendingMessageIdToRetry = null;

			writeMessage(val, messageId);
		}
	});
	$: $page.params.id, (isAborted = true);
	$: title = data.conversations.find((conv) => conv.id === $page.params.id)?.title ?? data.title;

	$: loginRequired =
		(data.requiresLogin
			? !data.user
			: !data.settings.ethicsModalAcceptedAt && !!PUBLIC_APP_DISCLAIMER) &&
		messages.length >= data.messagesBeforeLogin;
</script>

<svelte:head>
	<title>{title}</title>
</svelte:head>

<ChatWindow
	{loading}
	{pending}
	{messages}
	bind:webSearchMessages
	searches={{ ...data.searches }}
	on:message={(event) => writeMessage(event.detail)}
	on:retry={(event) => writeMessage(event.detail.content, event.detail.id)}
	on:vote={(event) => voteMessage(event.detail.score, event.detail.id)}
	on:share={() => shareConversation($page.params.id, data.title)}
	on:stop={() => (isAborted = true)}
	models={data.models}
	currentModel={findCurrentModel([...data.models, ...data.oldModels], data.model)}
	settings={data.settings}
	{loginRequired}
/>
