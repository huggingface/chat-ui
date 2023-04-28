<script lang="ts">
	import ChatWindow from "$lib/components/chat/ChatWindow.svelte";
	import { pendingMessage } from "$lib/stores/pendingMessage";
	import { pendingMessageIdToRetry } from "$lib/stores/pendingMessageIdToRetry";
	import { onMount } from "svelte";
	import { page } from "$app/stores";
	import { textGenerationStream } from "@huggingface/inference";
	import { invalidate } from "$app/navigation";
	import { base } from "$app/paths";
	import { PUBLIC_MAX_INPUT_TOKENS, PUBLIC_SEP_TOKEN } from "$env/static/public";
	import { shareConversation } from "$lib/shareConversation";
	import { UrlDependency } from "$lib/types/UrlDependency";
	import { error } from "$lib/stores/errors";
	import { randomUUID } from "$lib/utils/randomUuid";

	export let data;

	let messages = data.messages;
	let lastLoadedMessages = data.messages;
	let isAborted = false;

	// Since we modify the messages array locally, we don't want to reset it if an old version is passed
	$: if (data.messages !== lastLoadedMessages) {
		messages = data.messages;
		lastLoadedMessages = data.messages;
	}

	let loading = false;
	let pending = false;

	async function getTextGenerationStream(inputs: string, messageId: string, isRetry = false) {
		let conversationId = $page.params.id;

		const response = textGenerationStream(
			{
				model: $page.url.href,
				inputs,
				parameters: {
					// Taken from https://huggingface.co/spaces/huggingface/open-assistant-private-testing/blob/main/app.py#L54
					temperature: 0.9,
					top_p: 0.95,
					repetition_penalty: 1.2,
					top_k: 50,
					// @ts-ignore
					truncate: parseInt(PUBLIC_MAX_INPUT_TOKENS),
					watermark: false,
					max_new_tokens: 1024,
					stop: [PUBLIC_SEP_TOKEN],
					return_full_text: false,
				},
			},
			{
				id: messageId,
				is_retry: isRetry,
				use_cache: false,
			}
		);

		for await (const data of response) {
			pending = false;

			if (!data) {
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
			if (data.generated_text) {
				const lastMessage = messages.at(-1);
				if (lastMessage) {
					lastMessage.content = data.generated_text;
					messages = [...messages];
				}
				break;
			}

			if (!data.token.special) {
				const lastMessage = messages.at(-1);

				if (lastMessage?.from !== "assistant") {
					// First token has a space at the beginning, trim it
					messages = [
						...messages,
						// id doesn't match the backend id but it's not important for assistant messages
						{ from: "assistant", content: data.token.text.trimStart(), id: randomUUID() },
					];
				} else {
					lastMessage.content += data.token.text;
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

	async function writeMessage(message: string, messageId = crypto.randomUUID()) {
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

			await getTextGenerationStream(message, messageId, isRetry);

			if (messages.filter((m) => m.from === "user").length === 1) {
				summarizeTitle($page.params.id)
					.then(() => invalidate(UrlDependency.ConversationList))
					.catch(console.error);
			} else {
				await invalidate(UrlDependency.ConversationList);
			}
		} catch (err) {
			// TODO: Should prob check if this is really a TooManyRequests error
			$error = "Too much traffic, please try again.";
			console.error(err);
		} finally {
			loading = false;
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

	$: title = data.conversations.find((conv) => conv.id === $page.params.id)?.title ?? data.title;
</script>

<svelte:head>
	<title>{title}</title>
</svelte:head>

<ChatWindow
	{loading}
	{pending}
	{messages}
	on:message={(message) => writeMessage(message.detail)}
	on:retry={(message) => writeMessage(message.detail.content, message.detail.id)}
	on:share={() => shareConversation($page.params.id, data.title)}
	on:stop={() => (isAborted = true)}
/>
