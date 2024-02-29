<script lang="ts">
	import ChatWindow from "$lib/components/chat/ChatWindow.svelte";
	import { pendingMessage } from "$lib/stores/pendingMessage";
	import { isAborted } from "$lib/stores/isAborted";
	import { onMount } from "svelte";
	import { page } from "$app/stores";
	import { goto, invalidateAll } from "$app/navigation";
	import { base } from "$app/paths";
	import { shareConversation } from "$lib/shareConversation";
	import { ERROR_MESSAGES, error } from "$lib/stores/errors";
	import { findCurrentModel } from "$lib/utils/models";
	import { webSearchParameters } from "$lib/stores/webSearchParameters";
	import type { Message } from "$lib/types/Message";
	import type { MessageUpdate } from "$lib/types/MessageUpdate";
	import titleUpdate from "$lib/stores/titleUpdate";
	import file2base64 from "$lib/utils/file2base64";
	import { addChildren } from "$lib/utils/tree/addChildren";
	import { addSibling } from "$lib/utils/tree/addSibling";
	import { createConvTreeStore } from "$lib/stores/convTree";
	import type { v4 } from "uuid";

	export let data;

	$: ({ messages } = data);

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
		messageId = $convTreeStore.leaf ?? undefined,
		isRetry = false,
		isContinue = false,
	}: {
		prompt?: string;
		messageId?: ReturnType<typeof v4>;
		isRetry?: boolean;
		isContinue?: boolean;
	}): Promise<void> {
		try {
			$isAborted = false;
			loading = true;
			pending = true;

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

			let messageToWriteToId: Message["id"] | undefined = undefined;
			// used for building the prompt, subtree of the conversation that goes from the latest message to the root

			if (isContinue && messageId) {
				if ((messages.find((msg) => msg.id === messageId)?.children?.length ?? 0) > 0) {
					$error = "Can only continue the last message";
				} else {
					messageToWriteToId = messageId;
				}
			} else if (isRetry && messageId) {
				// two cases, if we're retrying a user message with a newPrompt set,
				// it means we're editing a user message
				// if we're retrying on an assistant message, newPrompt cannot be set
				// it means we're retrying the last assistant message for a new answer

				const messageToRetry = messages.find((message) => message.id === messageId);

				if (!messageToRetry) {
					$error = "Message not found";
				}

				if (messageToRetry?.from === "user" && prompt) {
					// add a sibling to this message from the user, with the alternative prompt
					// add a children to that sibling, where we can write to
					const newUserMessageId = addSibling(
						{
							messages,
							rootMessageId: data.rootMessageId,
						},
						{ from: "user", content: prompt },
						messageId
					);
					messageToWriteToId = addChildren(
						{
							messages,
							rootMessageId: data.rootMessageId,
						},
						{ from: "assistant", content: "", files: resizedImages },
						newUserMessageId
					);
				} else if (messageToRetry?.from === "assistant") {
					// we're retrying an assistant message, to generate a new answer
					// just add a sibling to the assistant answer where we can write to
					messageToWriteToId = addSibling(
						{
							messages,
							rootMessageId: data.rootMessageId,
						},
						{ from: "assistant", content: "" },
						messageId
					);
				}
			} else {
				// just a normal linear conversation, so we add the user message
				// and the blank assistant message back to back
				const newUserMessageId = addChildren(
					{
						messages,
						rootMessageId: data.rootMessageId,
					},
					{
						from: "user",
						content: prompt ?? "",
						files: resizedImages,
						createdAt: new Date(),
						updatedAt: new Date(),
					},
					messageId
				);

				if (!data.rootMessageId) {
					data.rootMessageId = newUserMessageId;
				}

				messageToWriteToId = addChildren(
					{
						messages,
						rootMessageId: data.rootMessageId,
					},
					{
						from: "assistant",
						content: "",
						createdAt: new Date(),
						updatedAt: new Date(),
					},
					newUserMessageId
				);
			}

			messages = [...messages];
			const messageToWriteTo = messages.find((message) => message.id === messageToWriteToId);

			if (!messageToWriteTo) {
				throw new Error("Message to write to not found");
			}
			// disable websearch if assistant is present
			const hasAssistant = !!$page.data.assistant;

			const response = await fetch(`${base}/conversation/${$page.params.id}`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					inputs: prompt,
					id: messageId,
					is_retry: isRetry,
					is_continue: isContinue,
					web_search: !hasAssistant && $webSearchParameters.useSearch,
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
				if ($isAborted || $error) {
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
								loading = false;
								pending = false;
							} else if (update.type === "stream") {
								pending = false;
								messageToWriteTo.content += update.token;
								messages = [...messages];
							} else if (update.type === "webSearch") {
								messageToWriteTo.updates = [...(messageToWriteTo.updates ?? []), update];
								messages = [...messages];
							} else if (update.type === "status") {
								if (update.status === "title" && update.message) {
									const convInData = data.conversations.find(({ id }) => id === $page.params.id);
									if (convInData) {
										convInData.title = update.message;

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

			messageToWriteTo.updates = messageUpdates;
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
			await invalidateAll();
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

	async function onRetry(event: CustomEvent<{ id: Message["id"]; content?: string }>) {
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
		} else {
			await convFromShared()
				.then(async (convId) => {
					await goto(`${base}/conversation/${convId}`, { invalidateAll: true });
				})
				.then(
					async () =>
						await writeMessage({
							messageId: event.detail.id,
							isContinue: true,
						})
				)
				.finally(() => (loading = false));
		}
	}

	$: $page.params.id, (($isAborted = true), (loading = false), ($convTreeStore.editing = null));
	$: title = data.conversations.find((conv) => conv.id === $page.params.id)?.title ?? data.title;

	const convTreeStore = createConvTreeStore();
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
	bind:files
	on:message={onMessage}
	on:retry={onRetry}
	on:continue={onContinue}
	on:vote={(event) => voteMessage(event.detail.score, event.detail.id)}
	on:share={() => shareConversation($page.params.id, data.title)}
	on:stop={() => (($isAborted = true), (loading = false))}
	models={data.models}
	currentModel={findCurrentModel([...data.models, ...data.oldModels], data.model)}
	assistant={data.assistant}
/>
