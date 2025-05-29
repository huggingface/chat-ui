<script lang="ts">
	import ChatWindow from "$lib/components/chat/ChatWindow.svelte";
	import { pendingMessage } from "$lib/stores/pendingMessage";
	import { isAborted } from "$lib/stores/isAborted";
	import { onMount } from "svelte";
	import { page } from "$app/state";
	import { beforeNavigate, goto, invalidateAll } from "$app/navigation";
	import { base } from "$app/paths";
	import { shareConversation } from "$lib/shareConversation";
	import { ERROR_MESSAGES, error } from "$lib/stores/errors";
	import { findCurrentModel } from "$lib/utils/models";
	import { webSearchParameters } from "$lib/stores/webSearchParameters";
	import type { Message } from "$lib/types/Message";
	import {
		MessageReasoningUpdateType,
		MessageUpdateStatus,
		MessageUpdateType,
	} from "$lib/types/MessageUpdate";
	import titleUpdate from "$lib/stores/titleUpdate";
	import file2base64 from "$lib/utils/file2base64";
	import { addChildren } from "$lib/utils/tree/addChildren";
	import { addSibling } from "$lib/utils/tree/addSibling";
	import { fetchMessageUpdates } from "$lib/utils/messageUpdates";
	import type { v4 } from "uuid";
	import { useSettingsStore } from "$lib/stores/settings.js";
	import { browser } from "$app/environment";

	import type { TreeNode, TreeId } from "$lib/utils/tree/tree";
	import "katex/dist/katex.min.css";
	import { updateDebouncer } from "$lib/utils/updates.js";
	import { documentParserToolId } from "$lib/utils/toolIds.js";

	let { data = $bindable() } = $props();

	let loading = $state(false);
	let pending = $state(false);
	let initialRun = true;

	let files: File[] = $state([]);

	let conversations = $state(data.conversations);
	$effect(() => {
		conversations = data.conversations;
	});

	function createMessagesPath<T>(messages: TreeNode<T>[], msgId?: TreeId): TreeNode<T>[] {
		if (initialRun) {
			if (!msgId && page.url.searchParams.get("leafId")) {
				msgId = page.url.searchParams.get("leafId") as string;
				page.url.searchParams.delete("leafId");
			}
			if (!msgId && browser && localStorage.getItem("leafId")) {
				msgId = localStorage.getItem("leafId") as string;
			}
			initialRun = false;
		}

		const msg = messages.find((msg) => msg.id === msgId) ?? messages.at(-1);
		if (!msg) return [];
		// ancestor path
		const { ancestors } = msg;
		const path = [];
		if (ancestors?.length) {
			for (const ancestorId of ancestors) {
				const ancestor = messages.find((msg) => msg.id === ancestorId);
				if (ancestor) {
					path.push(ancestor);
				}
			}
		}

		// push the node itself in the middle
		path.push(msg);

		// children path
		let childrenIds = msg.children;
		while (childrenIds?.length) {
			let lastChildId = childrenIds.at(-1);
			const lastChild = messages.find((msg) => msg.id === lastChildId);
			if (lastChild) {
				path.push(lastChild);
			}
			childrenIds = lastChild?.children;
		}

		return path;
	}

	function createMessagesAlternatives<T>(messages: TreeNode<T>[]): TreeId[][] {
		const alternatives = [];
		for (const message of messages) {
			if (message.children?.length) {
				alternatives.push(message.children);
			}
		}
		return alternatives;
	}

	async function convFromShared() {
		try {
			loading = true;
			const res = await fetch(`${base}/conversation`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					fromShare: page.params.id,
					model: data.model,
				}),
			});

			if (!res.ok) {
				error.set(await res.text());
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
		messageId = messagesPath.at(-1)?.id ?? undefined,
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
			const base64Files = await Promise.all(
				(files ?? []).map((file) =>
					file2base64(file).then((value) => ({
						type: "base64" as const,
						value,
						mime: file.type,
						name: file.name,
					}))
				)
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
						{
							from: "user",
							content: prompt,
							files: messageToRetry.files,
						},
						messageId
					);
					messageToWriteToId = addChildren(
						{
							messages,
							rootMessageId: data.rootMessageId,
						},
						{ from: "assistant", content: "" },
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
						files: base64Files,
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
					},
					newUserMessageId
				);
			}

			const userMessage = messages.find((message) => message.id === messageId);
			const messageToWriteTo = messages.find((message) => message.id === messageToWriteToId);
			if (!messageToWriteTo) {
				throw new Error("Message to write to not found");
			}

			// disable websearch if assistant is present
			const hasAssistant = !!page.data.assistant;
			const messageUpdatesAbortController = new AbortController();

			let tools = $settings.tools;

			if (!files.some((file) => file.type.startsWith("application/"))) {
				tools = $settings.tools?.filter((tool) => tool !== documentParserToolId);
			}

			const messageUpdatesIterator = await fetchMessageUpdates(
				page.params.id,
				{
					base,
					inputs: prompt,
					messageId,
					isRetry,
					isContinue,
					webSearch: !hasAssistant && !activeModel.tools && $webSearchParameters.useSearch,
					tools,
					files: isRetry ? userMessage?.files : base64Files,
				},
				messageUpdatesAbortController.signal
			).catch((err) => {
				error.set(err.message);
			});
			if (messageUpdatesIterator === undefined) return;

			files = [];
			let buffer = "";
			// Initialize lastUpdateTime outside the loop to persist between updates
			let lastUpdateTime = new Date();

			let reasoningBuffer = "";
			let reasoningLastUpdate = new Date();

			for await (const update of messageUpdatesIterator) {
				if ($isAborted) {
					messageUpdatesAbortController.abort();
					return;
				}

				// Remove null characters added due to remote keylogging prevention
				// See server code for more details
				if (update.type === MessageUpdateType.Stream) {
					update.token = update.token.replaceAll("\0", "");
				}

				const isHighFrequencyUpdate =
					(update.type === MessageUpdateType.Reasoning &&
						update.subtype === MessageReasoningUpdateType.Stream) ||
					update.type === MessageUpdateType.Stream ||
					(update.type === MessageUpdateType.Status &&
						update.status === MessageUpdateStatus.KeepAlive);

				if (!isHighFrequencyUpdate) {
					messageToWriteTo.updates = [...(messageToWriteTo.updates ?? []), update];
				}
				const currentTime = new Date();

				if (update.type === MessageUpdateType.Stream && !$settings.disableStream) {
					buffer += update.token;
					// Check if this is the first update or if enough time has passed
					if (currentTime.getTime() - lastUpdateTime.getTime() > updateDebouncer.maxUpdateTime) {
						messageToWriteTo.content += buffer;
						buffer = "";
						lastUpdateTime = currentTime;
					}
					pending = false;
				} else if (
					update.type === MessageUpdateType.Status &&
					update.status === MessageUpdateStatus.Error
				) {
					$error = update.message ?? "An error has occurred";
				} else if (update.type === MessageUpdateType.Title) {
					const convInData = conversations.find(({ id }) => id === page.params.id);
					if (convInData) {
						convInData.title = update.title;

						$titleUpdate = {
							title: update.title,
							convId: page.params.id,
						};
					}
				} else if (update.type === MessageUpdateType.File) {
					messageToWriteTo.files = [
						...(messageToWriteTo.files ?? []),
						{ type: "hash", value: update.sha, mime: update.mime, name: update.name },
					];
				} else if (update.type === MessageUpdateType.Reasoning) {
					if (!messageToWriteTo.reasoning) {
						messageToWriteTo.reasoning = "";
					}
					if (update.subtype === MessageReasoningUpdateType.Stream) {
						reasoningBuffer += update.token;
						if (
							currentTime.getTime() - reasoningLastUpdate.getTime() >
							updateDebouncer.maxUpdateTime
						) {
							messageToWriteTo.reasoning += reasoningBuffer;
							reasoningBuffer = "";
							reasoningLastUpdate = currentTime;
						}
					}
				}
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
			await invalidateAll();
		}
	}

	async function voteMessage(score: Message["score"], messageId: string) {
		let conversationId = page.params.id;
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
		const lastMsgId = event.detail.id;
		messagesPath = createMessagesPath(messages, lastMsgId);

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

	async function onShowAlternateMsg(event: CustomEvent<{ id: Message["id"] }>) {
		const msgId = event.detail.id;
		messagesPath = createMessagesPath(messages, msgId);
	}

	async function onContinue(event: CustomEvent<{ id: Message["id"] }>) {
		if (!data.shared) {
			await writeMessage({ messageId: event.detail.id, isContinue: true });
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

	const settings = useSettingsStore();
	let messages = $state(data.messages);
	$effect(() => {
		messages = data.messages;
	});

	let activeModel = $derived(findCurrentModel([...data.models, ...data.oldModels], data.model));
	// create a linear list of `messagesPath` from `messages` that is a tree of threaded messages
	let messagesPath = $derived(createMessagesPath(messages));
	let messagesAlternatives = $derived(createMessagesAlternatives(messages));

	$effect(() => {
		if (browser && messagesPath.at(-1)?.id) {
			localStorage.setItem("leafId", messagesPath.at(-1)?.id as string);
		}
	});

	beforeNavigate(() => {
		if (page.params.id) {
			$isAborted = true;
			loading = false;
		}
	});

	let title = $derived(
		conversations.find((conv) => conv.id === page.params.id)?.title ?? data.title
	);
</script>

<svelte:head>
	<title>{title}</title>
</svelte:head>

<ChatWindow
	{loading}
	{pending}
	messages={messagesPath as Message[]}
	{messagesAlternatives}
	shared={data.shared}
	preprompt={data.preprompt}
	bind:files
	on:message={onMessage}
	on:retry={onRetry}
	on:continue={onContinue}
	on:showAlternateMsg={onShowAlternateMsg}
	on:vote={(event) => voteMessage(event.detail.score, event.detail.id)}
	on:share={() => shareConversation(page.params.id, data.title)}
	on:stop={async () => {
		await fetch(`${base}/conversation/${page.params.id}/stop-generating`, {
			method: "POST",
		}).then((r) => {
			if (r.ok) {
				setTimeout(() => {
					$isAborted = true;
					loading = false;
				}, 3000);
			} else {
				$isAborted = true;
				loading = false;
			}
		});
	}}
	models={data.models}
	currentModel={findCurrentModel([...data.models, ...data.oldModels], data.model)}
	assistant={data.assistant}
/>
