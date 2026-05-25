<script lang="ts">
	import ChatWindow from "$lib/components/chat/ChatWindow.svelte";
	import { pendingMessage } from "$lib/stores/pendingMessage";
	import { isAborted } from "$lib/stores/isAborted";
	import { onMount } from "svelte";
	import { page } from "$app/state";
	import { beforeNavigate } from "$app/navigation";
	import { base } from "$app/paths";
	import { ERROR_MESSAGES, error } from "$lib/stores/errors";
	import { findCurrentModel } from "$lib/utils/models";
	import type { Message } from "$lib/types/Message";
	import { MessageUpdateStatus, MessageUpdateType } from "$lib/types/MessageUpdate";
	import titleUpdate from "$lib/stores/titleUpdate";
	import { addChildren } from "$lib/utils/tree/addChildren";
	import { fetchMessageUpdates, resolveStreamingMode } from "$lib/utils/messageUpdates";
	import { useSettingsStore } from "$lib/stores/settings.js";
	import { enabledServers, mcpServersLoaded } from "$lib/stores/mcpServers";
	import { get } from "svelte/store";
	import { loading } from "$lib/stores/loading.js";
	import { streamStart } from "$lib/utils/haptics";
	import { put as putLocalConv, localConversations } from "$lib/stores/localConversations";
	import "katex/dist/katex.min.css";

	let { data = $bindable() } = $props();

	let convId = $derived(page.params.id ?? "");
	let pending = $state(false);
	let messageUpdatesAbortController = new AbortController();

	let messages = $state<Message[]>(data.messages);
	let title = $state<string>(data.title);
	let model = $state<string>(data.model);
	let preprompt = $state<string | undefined>(data.preprompt);
	let rootMessageId = $state<string | undefined>(data.rootMessageId);

	const settings = useSettingsStore();

	function buildLinearPath(msgs: Message[]): Message[] {
		// Local mode keeps it simple: linear conversation, no branching.
		if (msgs.length === 0) return [];
		const last = msgs.at(-1);
		if (!last) return [];
		if (!last.ancestors?.length) return [last];
		const path: Message[] = [];
		for (const ancestorId of last.ancestors) {
			const ancestor = msgs.find((m) => m.id === ancestorId);
			if (ancestor) path.push(ancestor);
		}
		path.push(last);
		return path;
	}

	let messagesPath = $derived(buildLinearPath(messages));

	async function persist() {
		await putLocalConv({
			_id: convId,
			model,
			title,
			rootMessageId,
			messages,
			preprompt,
			createdAt: new Date(messagesPath[0]?.createdAt ?? new Date()),
			updatedAt: new Date(),
		});
	}

	async function writeMessage(prompt: string): Promise<void> {
		try {
			$isAborted = false;
			$loading = true;
			pending = true;

			const parentId = messagesPath.at(-1)?.id;
			const newUserMessageId = addChildren(
				{ messages, rootMessageId },
				{
					from: "user",
					content: prompt,
					createdAt: new Date(),
					updatedAt: new Date(),
				},
				parentId
			);
			if (!rootMessageId) rootMessageId = newUserMessageId;

			const messageToWriteToId = addChildren(
				{ messages, rootMessageId },
				{ from: "assistant", content: "", createdAt: new Date(), updatedAt: new Date() },
				newUserMessageId
			);

			const messageToWriteTo = messages.find((m) => m.id === messageToWriteToId);
			if (!messageToWriteTo) throw new Error("Message to write to not found");

			await persist();

			messageUpdatesAbortController = new AbortController();
			const streamingMode = resolveStreamingMode($settings);

			if (!get(mcpServersLoaded)) {
				await new Promise<void>((resolve) => {
					let unsub: (() => void) | undefined;
					unsub = mcpServersLoaded.subscribe((loadedNow) => {
						if (loadedNow) {
							unsub?.();
							resolve();
						}
					});
				});
			}

			// Pass full history (excluding the empty assistant placeholder) every
			// request — the server is stateless.
			const historyForServer = buildLinearPath(messages)
				.slice(0, -1)
				.map((m) => ({ from: m.from, content: m.content }));

			const iterator = await fetchMessageUpdates(
				convId,
				{
					base,
					isRetry: false,
					selectedMcpServerNames: $enabledServers.map((s) => s.name),
					selectedMcpServers: $enabledServers.map((s) => ({
						name: s.name,
						url: s.url,
						headers: s.headers,
					})),
					timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
					streamingMode,
					statelessEndpoint: "/api/v2/chat/stream",
					statelessRequest: {
						model,
						preprompt,
						messages: historyForServer,
					},
				},
				messageUpdatesAbortController.signal
			).catch((err) => {
				error.set(err.message);
			});
			if (iterator === undefined) return;

			for await (const update of iterator) {
				if ($isAborted) {
					messageUpdatesAbortController.abort();
					return;
				}

				// Strip the null-padding the server adds to defend against the
				// streamed-packet keylogging side-channel.
				if (update.type === MessageUpdateType.Stream) {
					update.token = update.token.replaceAll("\0", "");
				}

				const isKeepAlive =
					update.type === MessageUpdateType.Status &&
					update.status === MessageUpdateStatus.KeepAlive;

				if (!isKeepAlive) {
					messageToWriteTo.updates = [...(messageToWriteTo.updates ?? []), update];
				}

				if (update.type === MessageUpdateType.Stream) {
					messageToWriteTo.content += update.token;
					if (pending) streamStart();
					pending = false;
				} else if (update.type === MessageUpdateType.FinalAnswer) {
					messageToWriteTo.interrupted = update.interrupted;
					if (update.text) messageToWriteTo.content = update.text;
				} else if (
					update.type === MessageUpdateType.Status &&
					update.status === MessageUpdateStatus.Error
				) {
					$error = update.message ?? "An error has occurred";
				} else if (update.type === MessageUpdateType.RouterMetadata) {
					messageToWriteTo.routerMetadata = {
						route: update.route,
						model: update.model,
					};
				}
			}

			// Local title: first 5 words of the first user message — keeps parity
			// with the server-side fallback when LLM_SUMMARIZATION is off.
			if (title === "New Chat") {
				const firstUserMsg = messages.find((m) => m.from === "user");
				if (firstUserMsg) {
					title = firstUserMsg.content.split(/\s+/g).slice(0, 5).join(" ") || "New Chat";
					$titleUpdate = { title, convId };
				}
			}

			await persist();
		} catch (err) {
			if (err instanceof Error) {
				$error = err.message;
			} else {
				$error = ERROR_MESSAGES.default;
			}
			console.error(err);
		} finally {
			$loading = false;
			pending = false;
		}
	}

	function stopGeneration() {
		$isAborted = true;
		$loading = false;
		messageUpdatesAbortController.abort();
		const lastAssistant = messages.findLast((m) => m.from === "assistant");
		if (lastAssistant) {
			lastAssistant.interrupted = true;
		}
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === "Escape" && $loading) {
			event.preventDefault();
			stopGeneration();
		}
	}

	onMount(async () => {
		if ($pendingMessage) {
			const content = $pendingMessage.content;
			$pendingMessage = undefined;
			await writeMessage(content);
		}
	});

	beforeNavigate(() => {
		$isAborted = true;
		$loading = false;
		messageUpdatesAbortController.abort();
	});

	$effect(() => {
		// Stay in sync with the reactive store when other tabs/components delete
		// or rename this conversation.
		const updated = $localConversations.find((c) => c._id === convId);
		if (updated && updated.title !== title) {
			title = updated.title;
		}
	});

	let currentModel = $derived(findCurrentModel(page.data.models, page.data.oldModels, model));
</script>

<svelte:window onkeydown={handleKeydown} />

<svelte:head>
	<title>{title}</title>
</svelte:head>

<ChatWindow
	loading={$loading}
	{pending}
	messages={messagesPath as Message[]}
	{preprompt}
	onmessage={(content) => writeMessage(content)}
	onstop={stopGeneration}
	models={page.data.models}
	{currentModel}
/>
