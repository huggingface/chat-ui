<script lang="ts">
	import ChatWindow from "$lib/components/chat/ChatWindow.svelte";
	import { pendingMessage } from "$lib/stores/pendingMessage";
	import { isAborted } from "$lib/stores/isAborted";
	import { onMount } from "svelte";
	import { page } from "$app/state";
	import { beforeNavigate, invalidateAll } from "$app/navigation";
	import { base } from "$app/paths";
	import { ERROR_MESSAGES, error } from "$lib/stores/errors";
	import { findCurrentModel } from "$lib/utils/models";
	import type { Message } from "$lib/types/Message";
	import titleUpdate from "$lib/stores/titleUpdate";
	import file2base64 from "$lib/utils/file2base64";
	import { fetchMessageUpdates } from "$lib/utils/messageUpdates";
	import type { v4 } from "uuid";
	import { useSettingsStore } from "$lib/stores/settings.js";
	import { enabledServers } from "$lib/stores/mcpServers";
	import { browser } from "$app/environment";
	import {
		addBackgroundGeneration,
		removeBackgroundGeneration,
	} from "$lib/stores/backgroundGenerations";
	import type { TreeNode, TreeId } from "$lib/utils/tree/tree";
	import "katex/dist/katex.min.css";
	import { updateDebouncer } from "$lib/utils/updates.js";
	import SubscribeModal from "$lib/components/SubscribeModal.svelte";
	import { loading } from "$lib/stores/loading.js";
	import { requireAuthUser } from "$lib/utils/auth.js";
	import { isConversationGenerationActive } from "$lib/utils/generationState";
	import { prepareTurn, processClientUpdate } from "$lib/conversation/generation";

	let { data = $bindable() } = $props();

	let convId = $derived(page.params.id ?? "");
	let pending = $state(false);
	let initialRun = true;
	let showSubscribeModal = $state(false);
	let stopRequested = $state(false);

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

	// this function is used to send new message to the backends
	async function writeMessage({
		prompt,
		messageId = messagesPath.at(-1)?.id ?? undefined,
		isRetry = false,
	}: {
		prompt?: string;
		messageId?: ReturnType<typeof v4>;
		isRetry?: boolean;
	}): Promise<void> {
		try {
			stopRequested = false;
			$isAborted = false;
			$loading = true;
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
				const tree = { messages, rootMessageId: data.rootMessageId };

				try {
					const preparedTurn = prepareTurn({
						tree,
						messageId,
						prompt,
						isRetry,
						files: base64Files,
						createUserMessage: ({ prompt, files, retryTarget }) => ({
							from: "user",
							content: prompt,
							files: retryTarget?.files ?? files,
						}),
						createAssistantMessage: () => ({
							from: "assistant",
							content: "",
						}),
					});

					messageToWriteToId = preparedTurn.assistantMessageId;
					if (!data.rootMessageId && tree.rootMessageId) {
						data.rootMessageId = tree.rootMessageId;
					}
				} catch (prepareError) {
					if (prepareError instanceof Error && prepareError.message === "Message not found") {
						$error = "Message not found";
						return;
					}

					throw prepareError;
				}

			const userMessage = messages.find((message) => message.id === messageId);
			const messageToWriteTo = messages.find((message) => message.id === messageToWriteToId);
			if (!messageToWriteTo) {
				throw new Error("Message to write to not found");
			}

			const messageUpdatesAbortController = new AbortController();

			const messageUpdatesIterator = await fetchMessageUpdates(
				convId,
				{
					base,
					inputs: prompt,
					messageId,
					isRetry,
					files: isRetry ? userMessage?.files : base64Files,
					selectedMcpServerNames: $enabledServers.map((s) => s.name),
					selectedMcpServers: $enabledServers.map((s) => ({
						name: s.name,
						url: s.url,
						headers: s.headers,
					})),
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

				for await (const update of messageUpdatesIterator) {
					if ($isAborted) {
						messageUpdatesAbortController.abort();
						return;
					}

					const processedUpdate = processClientUpdate({
						message: messageToWriteTo,
						update,
						disableStream: $settings.disableStream,
						buffer,
						lastUpdateTime,
						maxUpdateTimeMs: updateDebouncer.maxUpdateTime,
					});

					Object.assign(messageToWriteTo, processedUpdate.message);
					buffer = processedUpdate.buffer;
					lastUpdateTime = processedUpdate.lastUpdateTime;

					if (processedUpdate.effects.setPendingFalse) {
						pending = false;
					}
					if (processedUpdate.effects.showSubscribeModal) {
						showSubscribeModal = true;
					}
					if (processedUpdate.effects.errorMessage) {
						$error = processedUpdate.effects.errorMessage;
					}
					if (processedUpdate.effects.title) {
						const convInData = conversations.find(({ id }) => id === page.params.id);
						if (convInData) {
							convInData.title = processedUpdate.effects.title;
							$titleUpdate = {
								title: processedUpdate.effects.title,
								convId,
							};
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
			$loading = false;
			pending = false;
			await invalidateAll();
		}
	}

	async function stopGeneration() {
		stopRequested = true;
		$isAborted = true;
		$loading = false;

		const sendStopRequest = async () => {
			const response = await fetch(`${base}/conversation/${page.params.id}/stop-generating`, {
				method: "POST",
			});
			if (!response.ok) {
				throw new Error(`Stop request failed: ${response.status}`);
			}
		};

		try {
			await sendStopRequest();
		} catch (firstErr) {
			try {
				await new Promise((resolve) => setTimeout(resolve, 300));
				await sendStopRequest();
			} catch (retryErr) {
				console.error("Failed to stop generation", firstErr, retryErr);
				$error = "Failed to stop generation. Please try again.";
			}
		}
	}

	function handleKeydown(event: KeyboardEvent) {
		// Stop generation on ESC key when loading
		if (event.key === "Escape" && $loading) {
			event.preventDefault();
			stopGeneration();
		}
	}

	onMount(async () => {
		if ($pendingMessage) {
			files = $pendingMessage.files;
			await writeMessage({ prompt: $pendingMessage.content });
			$pendingMessage = undefined;
		}

		const streaming = isConversationGenerationActive(messages);
		if (streaming) {
			addBackgroundGeneration({ id: convId, startedAt: Date.now() });
			$loading = true;
		}
	});

	async function onMessage(content: string) {
		await writeMessage({ prompt: content });
	}

	async function onRetry(payload: { id: Message["id"]; content?: string }) {
		if (requireAuthUser()) return;

		const lastMsgId = payload.id;
		messagesPath = createMessagesPath(messages, lastMsgId);

		await writeMessage({
			prompt: payload.content,
			messageId: payload.id,
			isRetry: true,
		});
	}

	async function onShowAlternateMsg(payload: { id: Message["id"] }) {
		const msgId = payload.id;
		messagesPath = createMessagesPath(messages, msgId);
	}

	const settings = useSettingsStore();
	let messages = $state(data.messages);
	$effect(() => {
		messages = data.messages;
	});

	$effect(() => {
		page.params.id;
		stopRequested = false;
	});

	$effect(() => {
		const streaming = isConversationGenerationActive(messages);
		if (stopRequested) {
			$loading = false;
		} else if (streaming) {
			$loading = true;
		} else if (!pending) {
			$loading = false;
		}

		if (!streaming && browser) {
			removeBackgroundGeneration(convId);
		}
	});

	// create a linear list of `messagesPath` from `messages` that is a tree of threaded messages
	let messagesPath = $derived(createMessagesPath(messages));
	let messagesAlternatives = $derived(createMessagesAlternatives(messages));

	$effect(() => {
		if (browser && messagesPath.at(-1)?.id) {
			localStorage.setItem("leafId", messagesPath.at(-1)?.id as string);
		}
	});

	beforeNavigate((navigation) => {
		if (!page.params.id) return;

		const navigatingAway =
			navigation.to?.route.id !== page.route.id || navigation.to?.params?.id !== page.params.id;

		if ($loading && navigatingAway) {
			addBackgroundGeneration({ id: page.params.id, startedAt: Date.now() });
		}

		$isAborted = true;
		$loading = false;
	});

	let title = $derived.by(() => {
		const rawTitle = conversations.find((conv) => conv.id === page.params.id)?.title ?? data.title;
		return rawTitle ? rawTitle.charAt(0).toUpperCase() + rawTitle.slice(1) : rawTitle;
	});
</script>

<svelte:window onkeydown={handleKeydown} />

<svelte:head>
	<title>{title}</title>
</svelte:head>

<ChatWindow
	loading={$loading}
	{pending}
	messages={messagesPath as Message[]}
	{messagesAlternatives}
	shared={data.shared}
	preprompt={data.preprompt}
	bind:files
	onmessage={onMessage}
	onretry={onRetry}
	onshowAlternateMsg={onShowAlternateMsg}
	onstop={stopGeneration}
	models={data.models}
	currentModel={findCurrentModel(data.models, data.oldModels, data.model)}
/>

{#if showSubscribeModal}
	<SubscribeModal close={() => (showSubscribeModal = false)} />
{/if}
