<script lang="ts">
	import ChatWindow from "$lib/components/chat/ChatWindow.svelte";
	import { pendingMessage } from "$lib/stores/pendingMessage";
	import { onMount } from "svelte";
	import { page } from "$app/stores";
	import { goto, invalidate } from "$app/navigation";
	import { base } from "$app/paths";
	import { shareConversation } from "$lib/shareConversation";
	import { UrlDependency } from "$lib/types/UrlDependency";
	import { ERROR_MESSAGES, error } from "$lib/stores/errors";
	import { randomUUID } from "$lib/utils/randomUuid";
	import { findCurrentModel } from "$lib/utils/models";
	import { webSearchParameters } from "$lib/stores/webSearchParameters";
	import type { Message } from "$lib/types/Message";
	import type { MessageUpdate, WebSearchUpdate } from "$lib/types/MessageUpdate";
	import titleUpdate from "$lib/stores/titleUpdate";
	import file2base64 from "$lib/utils/file2base64.js";
	export let data;

	let messages = data.messages;
	let lastLoadedMessages = data.messages;
	let isAborted = false;

	let webSearchMessages: WebSearchUpdate[] = [];

	// Since we modify the messages array locally, we don't want to reset it if an old version is passed
	$: if (data.messages !== lastLoadedMessages) {
		messages = data.messages;
		lastLoadedMessages = data.messages;
	}

	let loading = false;
	let pending = false;

	let files: File[] = [];

	async function convFromShared() {
		try {
			loading = true;
			const res = await fetch(`${base}/conversation`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					fromShare: $page.params.id,
					model: data.model,
				}),
			});

			if (!res.ok) {
				error.set("Error while creating conversation, try again.");
				console.error("Error while creating conversation: " + (await res.text()));
				return;
			}

			const { conversationId } = await res.json();

			return conversationId;
		} catch (err) {
			error.set(ERROR_MESSAGES.default);
			console.error(String(err));
			throw err;
		}
	}
	// this function is used to send new message to the backends
	async function writeMessage(message: string, messageId = randomUUID()) {
		if (!message.trim()) return;

		try {
			isAborted = false;
			loading = true;
			pending = true;

			// first we check if the messageId already exists, indicating a retry

			let retryMessageIndex = messages.findIndex((msg) => msg.id === messageId);
			const isRetry = retryMessageIndex !== -1;
			// if it's not a retry we just use the whole array
			if (!isRetry) {
				retryMessageIndex = messages.length;
			}

			const module = await import("browser-image-resizer");

			// currently, only IDEFICS is supported by TGI
			// the size of images is hardcoded to 224x224 in TGI
			// this will need to be configurable when support for more models is added
			const resizedImages = await Promise.all(
				files.map(async (file) => {
					return await module
						.readAndCompressImage(file, {
							maxHeight: 224,
							maxWidth: 224,
							quality: 1,
						})
						.then(async (el) => await file2base64(el as File));
				})
			);

			// slice up to the point of the retry
			messages = [
				...messages.slice(0, retryMessageIndex),
				{
					from: "user",
					content: message,
					id: messageId,
					files: isRetry ? messages[retryMessageIndex].files : resizedImages,
				},
			];

			files = [];

			const responseId = randomUUID();
			const response = await fetch(`${base}/conversation/${$page.params.id}`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					inputs: message,
					id: messageId,
					response_id: responseId,
					is_retry: isRetry,
					web_search: $webSearchParameters.useSearch,
					files: isRetry ? undefined : resizedImages,
				}),
			});

			files = [];
			if (!response.body) {
				throw new Error("Body not defined");
			}

			if (!response.ok) {
				error.set((await response.json())?.message);
				return;
			}

			// eslint-disable-next-line no-undef
			const encoder = new TextDecoderStream();
			const reader = response?.body?.pipeThrough(encoder).getReader();
			let finalAnswer = "";

			// this is a bit ugly
			// we read the stream until we get the final answer
			while (finalAnswer === "") {
				await new Promise((r) => setTimeout(r, 25));

				// check for abort
				if (isAborted) {
					reader?.cancel();
					break;
				}

				// if there is something to read
				await reader?.read().then(async ({ done, value }) => {
					// we read, if it's done we cancel
					if (done) {
						reader.cancel();
						return;
					}

					if (!value) {
						return;
					}

					// if it's not done we parse the value, which contains all messages
					const inputs = value.split("\n");
					inputs.forEach(async (el: string) => {
						try {
							const update = JSON.parse(el) as MessageUpdate;
							if (update.type === "finalAnswer") {
								finalAnswer = update.text;
								reader.cancel();
								loading = false;
								pending = false;
								invalidate(UrlDependency.Conversation);
							} else if (update.type === "stream") {
								pending = false;

								let lastMessage = messages[messages.length - 1];

								if (lastMessage.from !== "assistant") {
									messages = [
										...messages,
										{ from: "assistant", id: randomUUID(), content: update.token },
									];
								} else {
									lastMessage.content += update.token;
									messages = [...messages];
								}
							} else if (update.type === "webSearch") {
								webSearchMessages = [...webSearchMessages, update];
							} else if (update.type === "status") {
								if (update.status === "title" && update.message) {
									const conv = data.conversations.find(({ id }) => id === $page.params.id);
									if (conv) {
										conv.title = update.message;

										$titleUpdate = {
											title: update.message,
											convId: $page.params.id,
										};
									}
								} else if (update.status === "error") {
									$error = update.message ?? "An error has occurred";
								}
							} else if (update.type === "error") {
								error.set(update.message);
								reader.cancel();
							}
						} catch (parseError) {
							// in case of parsing error we wait for the next message
							return;
						}
					});
				});
			}

			// reset the websearchmessages
			webSearchMessages = [];

			await invalidate(UrlDependency.ConversationList);
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
		// only used in case of creating new conversations (from the parent POST endpoint)
		if ($pendingMessage) {
			files = $pendingMessage.files;
			await writeMessage($pendingMessage.content);
			$pendingMessage = undefined;
		}
	});

	async function onMessage(event: CustomEvent<string>) {
		if (!data.shared) {
			writeMessage(event.detail);
		} else {
			convFromShared()
				.then(async (convId) => {
					await goto(`${base}/conversation/${convId}`, { invalidateAll: true });
				})
				.then(() => writeMessage(event.detail))
				.finally(() => (loading = false));
		}
	}

	async function onRetry(event: CustomEvent<{ id: Message["id"]; content: string }>) {
		if (!data.shared) {
			writeMessage(event.detail.content, event.detail.id);
		} else {
			convFromShared()
				.then(async (convId) => {
					await goto(`${base}/conversation/${convId}`, { invalidateAll: true });
				})
				.then(() => writeMessage(event.detail.content, event.detail.id))
				.finally(() => (loading = false));
		}
	}

	$: $page.params.id, ((isAborted = true), (loading = false));
	$: title = data.conversations.find((conv) => conv.id === $page.params.id)?.title ?? data.title;
</script>

<svelte:head>
	<title>{title}</title>
	<link
		rel="stylesheet"
		href="https://cdn.jsdelivr.net/npm/katex@0.16.8/dist/katex.min.css"
		integrity="sha384-GvrOXuhMATgEsSwCs4smul74iXGOixntILdUW9XmUC6+HX0sLNAK3q71HotJqlAn"
		crossorigin="anonymous"
	/>
</svelte:head>

<ChatWindow
	{loading}
	{pending}
	{messages}
	shared={data.shared}
	preprompt={data.preprompt}
	bind:webSearchMessages
	bind:files
	on:message={onMessage}
	on:retry={onRetry}
	on:vote={(event) => voteMessage(event.detail.score, event.detail.id)}
	on:share={() => shareConversation($page.params.id, data.title)}
	on:stop={() => (isAborted = true)}
	models={data.models}
	currentModel={findCurrentModel([...data.models, ...data.oldModels], data.model)}
	settings={data.settings}
/>
