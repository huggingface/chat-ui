<script lang="ts">
	import ChatWindow from "$lib/components/chat/ChatWindow.svelte";
	import { pendingMessage } from "$lib/stores/pendingMessage";
	import { isAborted } from "$lib/stores/isAborted";
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
	import file2base64 from "$lib/utils/file2base64";
	export let data;

	let messages = data.messages;
	let lastLoadedMessages = data.messages;

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
	async function writeMessage({
		prompt,
		messageId = randomUUID(),
		isRetry = false,
		isContinue = false,
	}: {
		prompt?: string;
		messageId?: ReturnType<typeof randomUUID>;
		isRetry?: boolean;
		isContinue?: boolean;
	}): Promise<void> {
		try {
			$isAborted = false;
			loading = true;
			pending = true;

			// first we check if the messageId already exists, indicating a retry

			let msgIndex = messages.findIndex((msg) => msg.id === messageId);

			if (msgIndex === -1) {
				msgIndex = messages.length - 1;
			}
			if (isRetry && messages[msgIndex].from === "assistant") {
				throw new Error("Trying to retry a message that is not from user");
			}

			if (isContinue && messages[msgIndex].from === "user") {
				throw new Error("Trying to continue a message that is not from assistant");
			}

			// const isNewMessage = !isRetry && !isContinue;

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
			if (isRetry) {
				messages = [
					...messages.slice(0, msgIndex),
					{
						from: "user",
						content: messages[msgIndex].content,
						id: messageId,
						files: messages[msgIndex].files,
					},
				];
			} else if (!isContinue) {
				// or add a new message if its not a continue request
				if (!prompt) {
					throw new Error("Prompt is undefined");
				}
				messages = [
					...messages,
					{
						from: "user",
						content: prompt ?? "",
						id: messageId,
						files: resizedImages,
					},
				];
			}

			files = [];

			const response = await fetch(`${base}/conversation/${$page.params.id}`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					inputs: prompt,
					id: messageId,
					is_retry: isRetry,
					is_continue: isContinue,
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
			const messageUpdates: MessageUpdate[] = [];

			// set str queue
			// ex) if the last response is => {"type": "stream", "token":
			// It should be => {"type": "stream", "token": "Hello"} = prev_input_chunk + "Hello"}
			let prev_input_chunk = [""];

			// this is a bit ugly
			// we read the stream until we get the final answer
			while (finalAnswer === "") {
				// check for abort
				if ($isAborted) {
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

					value = prev_input_chunk.pop() + value;

					// if it's not done we parse the value, which contains all messages
					const inputs = value.split("\n");
					inputs.forEach(async (el: string) => {
						try {
							const update = JSON.parse(el) as MessageUpdate;

							if (update.type !== "stream") {
								messageUpdates.push(update);
							}

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

							if (el === inputs[inputs.length - 1]) {
								prev_input_chunk.push(el);
							}
							return;
						}
					});
				});
			}

			webSearchMessages = [];

			const lastMessage = messages[messages.length - 1];
			lastMessage.updates = messageUpdates;

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
				return { ...message, score };
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
			await writeMessage({ prompt: $pendingMessage.content });
			$pendingMessage = undefined;
		}
	});

	async function onMessage(event: CustomEvent<string>) {
		if (!data.shared) {
			await writeMessage({ prompt: event.detail });
		} else {
			await convFromShared()
				.then(async (convId) => {
					await goto(`${base}/conversation/${convId}`, { invalidateAll: true });
				})
				.then(async () => await writeMessage({ prompt: event.detail }))
				.finally(() => (loading = false));
		}
	}

	async function onRetry(event: CustomEvent<{ id: Message["id"]; content: string }>) {
		if (!data.shared) {
			await writeMessage({
				prompt: event.detail.content,
				messageId: event.detail.id,
				isRetry: true,
			});
		} else {
			await convFromShared()
				.then(async (convId) => {
					await goto(`${base}/conversation/${convId}`, { invalidateAll: true });
				})
				.then(
					async () =>
						await writeMessage({
							prompt: event.detail.content,
							messageId: event.detail.id,
							isRetry: true,
						})
				)
				.finally(() => (loading = false));
		}
	}

	async function onContinue(event: CustomEvent<{ id: Message["id"] }>) {
		if (!data.shared) {
			writeMessage({ messageId: event.detail.id, isContinue: true });
		}
	}

	$: $page.params.id, (($isAborted = true), (loading = false));
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
	on:continue={onContinue}
	on:vote={(event) => voteMessage(event.detail.score, event.detail.id)}
	on:share={() => shareConversation($page.params.id, data.title)}
	on:stop={() => (($isAborted = true), (loading = false))}
	models={data.models}
	currentModel={findCurrentModel([...data.models, ...data.oldModels], data.model)}
/>
